import { describe, it, expect, afterEach, vi } from 'vitest';
import { authMiddleware } from './auth';
import type { Request, Response, NextFunction } from 'express';

// Helper: create a mock request with a given Authorization header.
function mockReq(authHeader?: string): Partial<Request> {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

function mockRes(): Response {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as unknown as Response;
}

describe('authMiddleware', () => {
  const origToken = process.env.API_TOKEN;

  it('never blocks webhooks (client replies, Stripe), even with a token set', () => {
    process.env.API_TOKEN = 'secret-token';
    const req = { headers: {}, path: '/webhooks/resend/inbound' } as unknown as Request;
    const res = mockRes();
    let called = false;
    authMiddleware(req, res, (() => { called = true; }) as NextFunction);
    expect(called).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  afterEach(() => {
    process.env.API_TOKEN = origToken;
  });

  it('passes through when no API_TOKEN is set (open access)', () => {
    delete process.env.API_TOKEN;
    const req = mockReq() as Request;
    const res = mockRes();
    let called = false;
    const next: NextFunction = () => { called = true; };

    authMiddleware(req, res, next);
    expect(called).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects missing Authorization header when token is set', () => {
    process.env.API_TOKEN = 'supersecret';
    const req = mockReq() as Request;
    const res = mockRes();
    let called = false;
    const next: NextFunction = () => { called = true; };

    authMiddleware(req, res, next);
    expect(called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'missing or malformed authorization header' });
  });

  it('rejects malformed Authorization header', () => {
    process.env.API_TOKEN = 'supersecret';
    const req = mockReq('Basic abc123') as Request;
    const res = mockRes();
    let called = false;
    const next: NextFunction = () => { called = true; };

    authMiddleware(req, res, next);
    expect(called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects wrong token', () => {
    process.env.API_TOKEN = 'supersecret';
    const req = mockReq('Bearer wrongtoken') as Request;
    const res = mockRes();
    let called = false;
    const next: NextFunction = () => { called = true; };

    authMiddleware(req, res, next);
    expect(called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid token' });
  });

  it('passes through with correct token', () => {
    process.env.API_TOKEN = 'supersecret';
    const req = mockReq('Bearer supersecret') as Request;
    const res = mockRes();
    let called = false;
    const next: NextFunction = () => { called = true; };

    authMiddleware(req, res, next);
    expect(called).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('trims whitespace from token', () => {
    process.env.API_TOKEN = 'supersecret';
    const req = mockReq('Bearer  supersecret  ') as Request;
    const res = mockRes();
    let called = false;
    const next: NextFunction = () => { called = true; };

    authMiddleware(req, res, next);
    expect(called).toBe(true);
  });
});