/**
 * Kapso Sandbox Setup Automation
 *
 * Automates:
 * 1. Create temp email via mail.tm
 * 2. Sign up on Kapso
 * 3. Verify email (confirmation link)
 * 4. Login
 * 5. Navigate to Sandbox Testing
 * 6. Start sandbox session for a phone number
 * 7. Create API key
 * 8. Save credentials
 */

const KAPSO_URL = 'https://app.kapso.ai';
const MAILTM_API = 'https://api.mail.tm';
const KAPSO_PASSWORD = 'HiveClip2026!Secure';

// ─── Mail.tm helpers ───

async function createTempEmail() {
  const domainsResp = await fetch(`${MAILTM_API}/domains`);
  const domains = await domainsResp.json();
  const domain = domains['hydra:member'][0].domain;

  const user = 'hive' + Math.random().toString(36).slice(2, 10);
  const email = `${user}@${domain}`;
  const password = 'HiveClip2026!';

  const createResp = await fetch(`${MAILTM_API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: email, password }),
  });
  if (!createResp.ok) {
    throw new Error(`mail.tm account creation failed: ${await createResp.text()}`);
  }

  const tokenResp = await fetch(`${MAILTM_API}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: email, password }),
  });
  const tokenData = await tokenResp.json();

  console.log(`[Mail] Created: ${email}`);
  return { email, password, token: tokenData.token, domain };
}

async function waitForEmail(token, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(`${MAILTM_API}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    const messages = data['hydra:member'] || [];

    if (messages.length > 0) {
      const msg = messages[0];
      const fullResp = await fetch(`${MAILTM_API}/messages/${msg.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const full = await fullResp.json();
      console.log(`[Mail] Got email: "${msg.subject}"`);
      return full;
    }

    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timeout waiting for email');
}

function extractConfirmationLink(emailContent) {
  // Normalize to string
  let text = '';
  if (typeof emailContent === 'string') text = emailContent;
  else if (Array.isArray(emailContent)) text = emailContent.join(' ');
  else if (emailContent && typeof emailContent === 'object') text = JSON.stringify(emailContent);
  else return null;

  const patterns = [
    /href="(https?:\/\/[^"]*confirm[^"]*)"/i,
    /href="(https?:\/\/[^"]*verify[^"]*)"/i,
    /href="(https?:\/\/[^"]*activate[^"]*)"/i,
    /(https?:\/\/app\.kapso\.ai[^\s"<]*confirm[^\s"<]*)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  const fallback = text.match(/href="(https?:\/\/app\.kapso\.ai[^"]*)"/i);
  if (fallback) return fallback[1];
  return null;
}

// ─── Main automation ───

async function run(phoneNumber) {
  if (!phoneNumber) {
    console.error('Usage: node kapso-setup.js <phone_number>');
    console.error('Example: node kapso-setup.js +5561999196929');
    process.exit(1);
  }

  const phone = phoneNumber.replace(/[\s\-()]/g, '');
  console.log(`[Setup] Target phone: ${phone}`);

  // Step 1: Create temp email
  console.log('\n=== Step 1: Create temp email ===');
  const mail = await createTempEmail();

  // Step 2: Sign up on Kapso
  console.log('\n=== Step 2: Sign up on Kapso ===');

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${KAPSO_URL}/users/sign_up`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: 'kapso-step01-signup.png' });
    console.log('[Playwright] Signup page loaded');

    // Fill signup form
    const emailInput = page.locator('input[type="email"], input[name*="email"], input[id*="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    await emailInput.fill(mail.email);
    await passwordInput.fill(KAPSO_PASSWORD);

    // Password confirmation field
    const passConfirm = page.locator('input[type="password"]').nth(1);
    if (await passConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await passConfirm.fill(KAPSO_PASSWORD);
    }

    await page.screenshot({ path: 'kapso-step02-filled.png' });
    console.log('[Playwright] Form filled');

    // Submit signup
    const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
    await submitBtn.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'kapso-step03-after-signup.png' });
    console.log('[Playwright] Signup submitted');

    // Step 3: Email confirmation (Kapso uses Devise - sends confirmation LINK)
    console.log('\n=== Step 3: Email confirmation ===');

    const emailMsg = await waitForEmail(mail.token, 60000);
    const emailHtml = emailMsg.html || '';
    const emailText = emailMsg.text || '';
    console.log(`[Mail] Subject: "${emailMsg.subject}"`);
    console.log(`[Mail] HTML preview: ${emailHtml.slice(0, 500)}`);
    console.log(`[Mail] Text preview: ${emailText.slice(0, 500)}`);

    const confirmLink = extractConfirmationLink(emailHtml) || extractConfirmationLink(emailText);
    if (confirmLink) {
      console.log(`[Mail] Confirmation link found: ${confirmLink.slice(0, 100)}...`);
      // Visit confirmation link in browser
      await page.goto(confirmLink, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'kapso-step04-after-confirm.png' });
      console.log(`[Playwright] After confirmation, URL: ${page.url()}`);
    } else {
      console.log('[Mail] No confirmation link found! Email content:');
      console.log(emailHtml.slice(0, 1000) || emailText.slice(0, 1000));
    }

    // Step 4: Login
    console.log('\n=== Step 4: Login ===');

    // After confirmation, Kapso redirects to login page
    const afterConfirmUrl = page.url();
    if (!afterConfirmUrl.includes('dashboard') && !afterConfirmUrl.includes('/app')) {
      // Navigate to login explicitly
      if (!afterConfirmUrl.includes('sign_in')) {
        await page.goto(`${KAPSO_URL}/users/sign_in`, { waitUntil: 'networkidle', timeout: 30000 });
      }
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'kapso-step05-login-page.png' });

      // Fill login form (use Kapso's own form, not Google OAuth)
      const loginEmail = page.locator('input[type="email"], input[name*="email"]').first();
      const loginPass = page.locator('input[type="password"]').first();

      if (await loginEmail.isVisible({ timeout: 5000 }).catch(() => false)) {
        await loginEmail.fill(mail.email);
        await loginPass.fill(KAPSO_PASSWORD);

        // Click "Log in" button (not Google/GitHub)
        const loginBtn = page.locator('button[type="submit"], input[type="submit"]').first();
        await loginBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    }

    await page.screenshot({ path: 'kapso-step06-after-login.png' });
    console.log(`[Playwright] After login, URL: ${page.url()}`);

    // Check if we're actually logged in
    const loginUrl = page.url();
    if (loginUrl.includes('sign_in') || loginUrl.includes('google.com')) {
      console.error('[Error] Login failed - still on login/OAuth page');
      await page.screenshot({ path: 'kapso-error-login.png' });
      throw new Error('Login failed');
    }

    // Step 5: Navigate to Sandbox Testing
    console.log('\n=== Step 5: Navigate to Sandbox Testing ===');

    // Try direct URL first
    await page.goto(`${KAPSO_URL}/phone_numbers/sandbox`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'kapso-step07-sandbox-direct.png' });
    console.log(`[Playwright] Sandbox direct URL: ${page.url()}`);

    // If direct URL didn't work, navigate via sidebar
    if (!page.url().includes('sandbox')) {
      // Try sidebar navigation
      const phoneNumbersLink = page.locator('a, button, [role="menuitem"]').filter({ hasText: /phone.?number/i }).first();
      if (await phoneNumbersLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await phoneNumbersLink.click();
        await page.waitForTimeout(2000);
      }

      const sandboxLink = page.locator('a, button, [role="menuitem"]').filter({ hasText: /sandbox/i }).first();
      if (await sandboxLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await sandboxLink.click();
        await page.waitForTimeout(2000);
      }
    }

    await page.screenshot({ path: 'kapso-step08-sandbox-page.png' });
    console.log(`[Playwright] Sandbox page URL: ${page.url()}`);

    // Dump page text for debugging
    const sandboxText = await page.textContent('body').catch(() => '');
    console.log(`[Sandbox] Page text preview: ${sandboxText.slice(0, 500)}`);

    // Step 6: Start new session
    console.log('\n=== Step 6: Start sandbox session ===');

    const startBtn = page.locator('button, a').filter({ hasText: /start.*session|new.*session|add.*number|add.*phone/i }).first();
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(2000);
      console.log('[Playwright] Clicked start session');
    }

    // Fill phone number
    const phoneInput = page.locator('input[type="tel"], input[name*="phone"], input[placeholder*="phone" i], input[placeholder*="number" i]').first();
    if (await phoneInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await phoneInput.fill(phone);
      console.log(`[Playwright] Phone filled: ${phone}`);
    }

    await page.screenshot({ path: 'kapso-step09-phone-filled.png' });

    // Submit
    const createBtn = page.locator('button').filter({ hasText: /create|send|submit|start|add/i }).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: 'kapso-step10-session-created.png' });
    console.log('[Playwright] Session creation attempted');

    // Check for sandbox verification code on page
    const pageText2 = await page.textContent('body').catch(() => '');
    console.log(`[Session] Page text: ${pageText2.slice(0, 500)}`);
    const codeMatch = pageText2.match(/code[:\s]+(\w{4,8})/i);
    if (codeMatch) {
      console.log(`[Sandbox] Verification code: ${codeMatch[1]}`);
    }

    // Step 7: Create API Key
    console.log('\n=== Step 7: Create API Key ===');

    // Try direct URL
    await page.goto(`${KAPSO_URL}/api_keys`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'kapso-step11-apikeys-page.png' });

    // If direct URL didn't work, try sidebar
    if (!page.url().includes('api_key')) {
      const apiKeysLink = page.locator('a, button, [role="menuitem"]').filter({ hasText: /api.?key/i }).first();
      if (await apiKeysLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await apiKeysLink.click();
        await page.waitForTimeout(2000);
      }
    }

    const createKeyBtn = page.locator('button').filter({ hasText: /create|new|generate/i }).first();
    if (await createKeyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createKeyBtn.click();
      await page.waitForTimeout(2000);

      const keyNameInput = page.locator('input[name*="name"], input[placeholder*="name" i]').first();
      if (await keyNameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await keyNameInput.fill('hiveclip-auto');
        const saveBtn = page.locator('button').filter({ hasText: /create|save|generate/i }).first();
        await saveBtn.click();
        await page.waitForTimeout(3000);
      }

      await page.screenshot({ path: 'kapso-step12-apikey-created.png' });

      const keyText = await page.textContent('body').catch(() => '');
      const keyMatch = keyText.match(/([a-f0-9]{64})/);
      if (keyMatch) {
        console.log(`[API Key] ${keyMatch[1]}`);
      }
    }

    // Save credentials
    const credentials = {
      email: mail.email,
      password: KAPSO_PASSWORD,
      mailTmToken: mail.token,
      createdAt: new Date().toISOString(),
      phone,
      kapsoUrl: KAPSO_URL,
    };

    const fs = require('fs');
    fs.writeFileSync(
      require('path').join(__dirname, '..', '.kapso-credentials.json'),
      JSON.stringify(credentials, null, 2)
    );
    console.log('\n[Setup] Credentials saved to .kapso-credentials.json');

    // Final screenshot
    await page.screenshot({ path: 'kapso-step13-final.png', fullPage: true });

  } catch (err) {
    console.error('[Error]', err.message);
    await page.screenshot({ path: 'kapso-error.png' }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log('\n=== Done ===');
  console.log('Check kapso-step*.png screenshots for visual progress');
}

// Run
const phone = process.argv[2] || '+5561999196929';
run(phone).catch(console.error);
