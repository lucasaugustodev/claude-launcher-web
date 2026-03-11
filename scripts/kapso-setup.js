/**
 * Kapso Sandbox Setup Automation
 *
 * Automates:
 * 1. Create temp email via mail.tm
 * 2. Sign up on Kapso
 * 3. Verify email
 * 4. Navigate to Sandbox Testing
 * 5. Start sandbox session for a phone number
 * 6. Create API key
 * 7. Save credentials
 */

const KAPSO_URL = 'https://app.kapso.ai';
const MAILTM_API = 'https://api.mail.tm';

// ─── Mail.tm helpers ───

async function createTempEmail() {
  // Get available domain
  const domainsResp = await fetch(`${MAILTM_API}/domains`);
  const domains = await domainsResp.json();
  const domain = domains['hydra:member'][0].domain;

  // Generate random email
  const user = 'hive' + Math.random().toString(36).slice(2, 10);
  const email = `${user}@${domain}`;
  const password = 'HiveClip2026!';

  // Create account
  const createResp = await fetch(`${MAILTM_API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: email, password }),
  });
  if (!createResp.ok) {
    throw new Error(`mail.tm account creation failed: ${await createResp.text()}`);
  }

  // Get token
  const tokenResp = await fetch(`${MAILTM_API}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: email, password }),
  });
  const tokenData = await tokenResp.json();

  console.log(`[Mail] Created: ${email}`);
  return { email, password, token: tokenData.token, domain };
}

async function waitForEmail(token, subject, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(`${MAILTM_API}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    const messages = data['hydra:member'] || [];

    for (const msg of messages) {
      if (!subject || (msg.subject && msg.subject.toLowerCase().includes(subject.toLowerCase()))) {
        // Get full message
        const fullResp = await fetch(`${MAILTM_API}/messages/${msg.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const full = await fullResp.json();
        console.log(`[Mail] Got email: "${msg.subject}"`);
        return full;
      }
    }

    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timeout waiting for email');
}

function extractCode(emailBody) {
  // Try common patterns for verification codes
  const patterns = [
    /\b(\d{6})\b/,           // 6-digit code
    /\b(\d{4})\b/,           // 4-digit code
    /code[:\s]+(\w+)/i,      // "code: XXXX"
    /verify[:\s]+(\w+)/i,    // "verify: XXXX"
  ];
  const text = typeof emailBody === 'string' ? emailBody : (emailBody.text || emailBody.html || '');
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Main automation ───

async function run(phoneNumber) {
  if (!phoneNumber) {
    console.error('Usage: node kapso-setup.js <phone_number>');
    console.error('Example: node kapso-setup.js +5561999196929');
    process.exit(1);
  }

  // Normalize phone
  const phone = phoneNumber.replace(/[\s\-()]/g, '');
  console.log(`[Setup] Target phone: ${phone}`);

  // Step 1: Create temp email
  console.log('\n=== Step 1: Create temp email ===');
  const mail = await createTempEmail();

  // Step 2: Sign up on Kapso with Playwright
  console.log('\n=== Step 2: Sign up on Kapso ===');

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Go to signup
    await page.goto(`${KAPSO_URL}/users/sign_up`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: 'kapso-step01-signup.png' });
    console.log('[Playwright] Signup page loaded');

    // Fill signup form
    // Look for email and password fields
    const emailInput = page.locator('input[type="email"], input[name*="email"], input[id*="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    await emailInput.fill(mail.email);
    await passwordInput.fill('HiveClip2026!Secure');

    // Check for password confirmation
    const passConfirm = page.locator('input[type="password"]').nth(1);
    if (await passConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await passConfirm.fill('HiveClip2026!Secure');
    }

    await page.screenshot({ path: 'kapso-step02-filled.png' });
    console.log('[Playwright] Form filled');

    // Submit
    const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
    await submitBtn.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'kapso-step03-after-signup.png' });
    console.log('[Playwright] Signup submitted');

    // Step 3: Check for email verification
    console.log('\n=== Step 3: Email verification ===');

    // Wait for verification email
    let verificationCode = null;
    try {
      const emailMsg = await waitForEmail(mail.token, 'verif', 60000);
      const body = emailMsg.text || emailMsg.html || JSON.stringify(emailMsg);
      console.log(`[Mail] Email body preview: ${body.slice(0, 300)}`);
      verificationCode = extractCode(body);
      console.log(`[Mail] Verification code: ${verificationCode}`);
    } catch (err) {
      console.log('[Mail] No verification email found, checking if auto-verified...');
    }

    // If there's a code input on page, fill it
    if (verificationCode) {
      const codeInput = page.locator('input[name*="code"], input[name*="token"], input[name*="otp"], input[placeholder*="code" i]').first();
      if (await codeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await codeInput.fill(verificationCode);
        const verifyBtn = page.locator('button[type="submit"]').first();
        await verifyBtn.click();
        await page.waitForTimeout(3000);
        console.log('[Playwright] Verification code submitted');
      }
    }

    // Check if we need to click a verification link instead
    if (!verificationCode) {
      try {
        const emailMsg = await waitForEmail(mail.token, '', 30000);
        const body = emailMsg.html || emailMsg.text || '';
        const linkMatch = body.match(/href="(https?:\/\/[^"]*(?:confirm|verify|activate)[^"]*)"/i);
        if (linkMatch) {
          console.log(`[Mail] Found verification link, visiting...`);
          await page.goto(linkMatch[1], { waitUntil: 'networkidle', timeout: 15000 });
          await page.waitForTimeout(3000);
          await page.screenshot({ path: 'kapso-step03b-verified.png' });
        }
      } catch {}
    }

    await page.screenshot({ path: 'kapso-step04-verified.png' });

    // Step 4: Navigate to dashboard, then Sandbox Testing
    console.log('\n=== Step 4: Navigate to Sandbox Testing ===');

    // Try logging in if we're not already
    const currentUrl = page.url();
    if (currentUrl.includes('sign_in') || currentUrl.includes('login')) {
      console.log('[Playwright] Need to login...');
      const loginEmail = page.locator('input[type="email"], input[name*="email"]').first();
      const loginPass = page.locator('input[type="password"]').first();
      await loginEmail.fill(mail.email);
      await loginPass.fill('HiveClip2026!Secure');
      const loginBtn = page.locator('button[type="submit"]').first();
      await loginBtn.click();
      await page.waitForTimeout(5000);
    }

    await page.screenshot({ path: 'kapso-step05-dashboard.png' });
    console.log(`[Playwright] Current URL: ${page.url()}`);

    // Navigate to Phone Numbers > Sandbox Testing
    // Look for sidebar navigation
    const phoneNumbersLink = page.locator('a, button, [role="menuitem"]').filter({ hasText: /phone.?number/i }).first();
    if (await phoneNumbersLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await phoneNumbersLink.click();
      await page.waitForTimeout(2000);
    }

    // Look for Sandbox Testing submenu
    const sandboxLink = page.locator('a, button, [role="menuitem"]').filter({ hasText: /sandbox/i }).first();
    if (await sandboxLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sandboxLink.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'kapso-step06-sandbox.png' });
    console.log('[Playwright] Sandbox page');

    // Step 5: Start new session
    console.log('\n=== Step 5: Start sandbox session ===');

    const startBtn = page.locator('button, a').filter({ hasText: /start.*session|new.*session|add/i }).first();
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(2000);
    }

    // Fill phone number
    const phoneInput = page.locator('input[type="tel"], input[name*="phone"], input[placeholder*="phone" i], input[placeholder*="number" i]').first();
    if (await phoneInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await phoneInput.fill(phone);
    }

    await page.screenshot({ path: 'kapso-step07-phone.png' });

    // Click create/submit
    const createBtn = page.locator('button').filter({ hasText: /create|send|submit|start/i }).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: 'kapso-step08-session-created.png' });
    console.log('[Playwright] Session creation attempted');

    // Step 6: Get sandbox code (might be shown on page)
    const pageText = await page.textContent('body');
    const codeMatch = pageText.match(/code[:\s]+(\w{4,8})/i);
    if (codeMatch) {
      console.log(`[Sandbox] Verification code: ${codeMatch[1]}`);
    }

    // Step 7: Create API Key
    console.log('\n=== Step 6: Create API Key ===');

    const apiKeysLink = page.locator('a, button, [role="menuitem"]').filter({ hasText: /api.?key/i }).first();
    if (await apiKeysLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await apiKeysLink.click();
      await page.waitForTimeout(2000);

      const createKeyBtn = page.locator('button').filter({ hasText: /create|new|generate/i }).first();
      if (await createKeyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await createKeyBtn.click();
        await page.waitForTimeout(2000);

        // Name the key
        const keyNameInput = page.locator('input[name*="name"], input[placeholder*="name" i]').first();
        if (await keyNameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await keyNameInput.fill('hiveclip-auto');
          const saveBtn = page.locator('button').filter({ hasText: /create|save|generate/i }).first();
          await saveBtn.click();
          await page.waitForTimeout(3000);
        }
      }

      await page.screenshot({ path: 'kapso-step09-apikey.png' });

      // Try to capture the API key from the page
      const keyText = await page.textContent('body');
      const keyMatch = keyText.match(/([a-f0-9]{64})/);
      if (keyMatch) {
        console.log(`[API Key] ${keyMatch[1]}`);
      }
    }

    // Save credentials
    const credentials = {
      email: mail.email,
      password: 'HiveClip2026!Secure',
      mailTmToken: mail.token,
      createdAt: new Date().toISOString(),
      phone,
    };

    const fs = require('fs');
    fs.writeFileSync(
      require('path').join(__dirname, '..', '.kapso-credentials.json'),
      JSON.stringify(credentials, null, 2)
    );
    console.log('\n[Setup] Credentials saved to .kapso-credentials.json');

    // Final screenshot
    await page.screenshot({ path: 'kapso-step10-final.png', fullPage: true });

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
