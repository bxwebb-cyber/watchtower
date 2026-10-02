// Dunn sign in / create account — the API side of login.html.
// The page (designer) fires wt:auth { mode, data }; this file does the real work.
(function () {
  const form = document.querySelector('[data-auth-form]');
  const errorBox = document.querySelector('.wt-auth__error');
  const submit = form.querySelector('button[type="submit"]');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  // Same rule the server enforces (src/routes/auth.ts).
  function passwordProblem(pw) {
    if (pw.length < 12) return 'Password must be at least 12 characters.';
    if (!/[A-Z]/.test(pw)) return 'Password needs an uppercase letter.';
    if (!/[a-z]/.test(pw)) return 'Password needs a lowercase letter.';
    if (!/[0-9]/.test(pw)) return 'Password needs a number.';
    return null;
  }

  // Show / hide password.
  const toggle = document.querySelector('[data-password-toggle]');
  toggle.addEventListener('click', () => {
    const input = form.password;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    toggle.querySelector('.ico-eye').style.display = showing ? 'block' : 'none';
    toggle.querySelector('.ico-eye-off').style.display = showing ? 'none' : 'block';
    toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });

  document.addEventListener('wt:auth', async (e) => {
    const { mode, data } = e.detail;
    const signup = mode === 'signup';
    errorBox.hidden = true;

    const email = (data.email || '').trim();
    const password = data.password || '';
    const ownerName = (data.owner_name || '').trim();
    const businessName = (data.business_name || '').trim();
    if (!email || !password) return showError('Enter your email and password.');
    if (signup) {
      if (!ownerName) return showError('Add your name. Emails sign off with it.');
      if (!businessName) return showError("Add your business name. It's what your clients see in every email.");
      const problem = passwordProblem(password);
      if (problem) return showError(problem);
      if (data.plan !== 'solo' && data.plan !== 'business') return showError('Pick a plan above. You can change it any time.');
    }

    const label = submit.textContent;
    const reset = () => { submit.disabled = false; submit.textContent = label; };
    submit.disabled = true;
    submit.textContent = signup ? 'Creating account…' : 'Signing in…';

    try {
      const res = await fetch(signup ? '/auth/signup' : '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(signup ? { email, password, ownerName, businessName, plan: data.plan } : { email, password }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { reset(); return showError(out.error || 'Something went wrong. Try again.'); }

      // Came from a pricing button → start the subscription checkout.
      const plan = data.plan || new URLSearchParams(location.search).get('plan');
      if (plan === 'solo' || plan === 'business') {
        const chk = await fetch('/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ plan, billing: new URLSearchParams(location.search).get('billing') === 'yearly' ? 'yearly' : 'monthly' }),
        });
        const c = await chk.json().catch(() => ({}));
        if (chk.ok && c.url) { location.href = c.url; return; }
        reset();
        return showError(c.error || 'Could not start checkout.');
      }

      // The session is an http-only cookie. New owners connect Stripe next.
      location.href = signup ? '/onboarding' : '/dashboard';
    } catch {
      reset();
      showError('Could not reach Dunn. Check your connection and try again.');
    }
  });
})();
