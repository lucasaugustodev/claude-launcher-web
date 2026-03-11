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
    const rawHtml = emailMsg.html;
    const rawText = emailMsg.text;
    const emailHtml = typeof rawHtml === 'string' ? rawHtml : (Array.isArray(rawHtml) ? rawHtml.join(' ') : JSON.stringify(rawHtml || ''));
    const emailText = typeof rawText === 'string' ? rawText : (Array.isArray(rawText) ? rawText.join(' ') : JSON.stringify(rawText || ''));
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
    console.log(`[Playwright] After confirm URL: ${afterConfirmUrl}`);

    // Check if we need to login (not already on dashboard)
    const needsLogin = afterConfirmUrl.includes('sign_in') || afterConfirmUrl.includes('login');
    if (needsLogin) {
      try {
        // Go to login page fresh
        await page.goto(`${KAPSO_URL}/users/sign_in`, { waitUntil: 'networkidle', timeout: 30000 });
        console.log('[Login] On login page');

        // Wait for email input to appear
        await page.waitForSelector('input[type="email"]', { timeout: 10000 });
        console.log('[Login] Email input found');

        // Type credentials using keyboard (more reliable than fill)
        await page.click('input[type="email"]');
        await page.keyboard.type(mail.email, { delay: 30 });
        console.log(`[Login] Typed email: ${mail.email}`);

        await page.click('input[type="password"]');
        await page.keyboard.type(KAPSO_PASSWORD, { delay: 30 });
        console.log('[Login] Typed password');

        await page.screenshot({ path: 'kapso-step05-login-filled.png' });

        // Press Enter to submit (simpler than finding button)
        await page.keyboard.press('Enter');
        console.log('[Login] Pressed Enter');

        // Wait for URL to change
        await page.waitForTimeout(8000);
        console.log(`[Login] URL after submit: ${page.url()}`);
      } catch (loginErr) {
        console.error(`[Login] Error: ${loginErr.message}`);
        await page.screenshot({ path: 'kapso-error-login.png' }).catch(() => {});
      }
    }

    await page.screenshot({ path: 'kapso-step06-after-login.png' });
    console.log(`[Playwright] After login, URL: ${page.url()}`);

    // Check if we're actually logged in
    const loginUrl = page.url();
    if (loginUrl.includes('sign_in') || loginUrl.includes('google.com')) {
      // Dump page for debug
      const pageHtml = await page.content();
      const errorMsg = pageHtml.match(/alert[^>]*>(.*?)<\/div/is);
      if (errorMsg) console.log(`[Login Error] ${errorMsg[1].trim()}`);
      console.error('[Error] Login failed - still on login page');
      await page.screenshot({ path: 'kapso-error-login.png' });
      throw new Error('Login failed');
    }

    // Close "Name your project" modal if present
    const laterBtn = page.locator('button').filter({ hasText: /later/i }).first();
    if (await laterBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await laterBtn.click();
      await page.waitForTimeout(1000);
      console.log('[Dashboard] Closed project naming modal');
    }

    // Extract project ID from URL for building correct URLs
    const dashUrl = page.url();
    const projectMatch = dashUrl.match(/projects\/([^/]+)/);
    const projectId = projectMatch ? projectMatch[1] : null;
    console.log(`[Dashboard] Project ID: ${projectId}`);

    await page.screenshot({ path: 'kapso-step07-dashboard.png' });

    // Step 5: Navigate to Phone Numbers > Sandbox Testing via sidebar
    console.log('\n=== Step 5: Navigate to Sandbox Testing ===');

    // Click "Phone numbers" in sidebar to expand submenu
    const phoneNumbersLink = page.locator('a, button').filter({ hasText: /phone\s*numbers/i }).first();
    if (await phoneNumbersLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await phoneNumbersLink.click();
      await page.waitForTimeout(1500);
      console.log('[Nav] Clicked Phone numbers');
    }

    await page.screenshot({ path: 'kapso-step08-phone-numbers.png' });

    // Look for "Sandbox testing" submenu item
    const sandboxLink = page.locator('a').filter({ hasText: /sandbox/i }).first();
    if (await sandboxLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sandboxLink.click();
      await page.waitForTimeout(3000);
      console.log('[Nav] Clicked Sandbox testing');
    } else {
      console.log('[Nav] Sandbox link not found, trying "Add number"');
      // Maybe it's under "Add number" > "Start" for sandbox
      const addNumberLink = page.locator('a').filter({ hasText: /add\s*number/i }).first();
      if (await addNumberLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await addNumberLink.click();
        await page.waitForTimeout(2000);
      }
    }

    await page.screenshot({ path: 'kapso-step09-sandbox-page.png' });
    console.log(`[Nav] Sandbox URL: ${page.url()}`);

    // Dump page content
    const sandboxText = await page.textContent('body').catch(() => '');
    console.log(`[Sandbox] Page preview: ${sandboxText.replace(/\s+/g, ' ').slice(0, 500)}`);

    // Step 6: Start new sandbox session
    console.log('\n=== Step 6: Start sandbox session ===');

    // Click "+ Start testing session" button specifically
    const startTestBtn = page.locator('button, a').filter({ hasText: /start testing session/i }).first();
    if (await startTestBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await startTestBtn.click();
      await page.waitForTimeout(2000);
      console.log('[Sandbox] Clicked "Start testing session"');
    } else {
      console.log('[Sandbox] "Start testing session" button not found');
    }

    await page.screenshot({ path: 'kapso-step10-after-start.png' });

    // Fill phone number in the modal dialog
    // The input has placeholder "+1234567890" - look for it in the dialog
    const phoneInput = page.locator('[role="dialog"] input, .modal input, [data-state="open"] input').first();
    if (await phoneInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await phoneInput.clear();
      await phoneInput.fill(phone);
      console.log(`[Sandbox] Phone filled: ${phone}`);

      await page.screenshot({ path: 'kapso-step10b-phone-filled.png' });

      // Click "Create" button inside the dialog
      const createSessionBtn = page.locator('[role="dialog"] button, .modal button').filter({ hasText: /create/i }).first();
      if (await createSessionBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await createSessionBtn.click();
        await page.waitForTimeout(5000);
        console.log('[Sandbox] Clicked Create');
      }
    } else {
      // Fallback: try any visible input on page
      const anyInput = page.locator('input[placeholder*="1234"]').first();
      if (await anyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await anyInput.clear();
        await anyInput.fill(phone);
        console.log(`[Sandbox] Phone filled (fallback): ${phone}`);
        await page.locator('button').filter({ hasText: /create/i }).last().click();
        await page.waitForTimeout(5000);
      } else {
        console.log('[Sandbox] No phone input found in modal');
      }
    }

    await page.screenshot({ path: 'kapso-step10c-session-result.png' });
    const sessionText = await page.textContent('body').catch(() => '');
    console.log(`[Session] Result: ${sessionText.replace(/\s+/g, ' ').slice(0, 500)}`);

    // Extract activation code from the "Activate WhatsApp Sandbox" modal
    const activationMatch = sessionText.match(/activation\s*code[:\s]*([A-Z0-9]{4,8})/i);
    let activationCode = null;
    if (activationMatch) {
      activationCode = activationMatch[1];
      console.log(`[Sandbox] Activation code: ${activationCode}`);
      console.log(`[Sandbox] User must send "${activationCode}" to sandbox number via WhatsApp to activate`);
    }

    // Close the activation modal
    const closeBtn = page.locator('button').filter({ hasText: /close/i }).first();
    if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(1000);
    }

    // Step 7: Create API Key via sidebar
    console.log('\n=== Step 7: Create API Key ===');

    // Close any open modal/overlay before navigating
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const apiKeysLink = page.locator('a').filter({ hasText: /api\s*keys/i }).first();
    if (await apiKeysLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await apiKeysLink.click();
      await page.waitForTimeout(3000);
      console.log('[Nav] Clicked API keys');

      await page.screenshot({ path: 'kapso-step11-apikeys-page.png' });

      // Click "+ Create new API key" or "+ Create API Key"
      const createKeyBtn = page.locator('button, a').filter({ hasText: /create.*api\s*key/i }).first();
      if (await createKeyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await createKeyBtn.click();
        await page.waitForTimeout(2000);
        console.log('[API] Clicked Create API Key');

        await page.screenshot({ path: 'kapso-step12-create-key-form.png' });

        // Fill key name if input is visible
        const keyNameInput = page.locator('input[name*="name"], input[placeholder*="name" i]').first();
        if (await keyNameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await keyNameInput.fill('hiveclip-auto');
          console.log('[API] Named key: hiveclip-auto');

          // Click the save/create button inside the modal
          const saveBtn = page.locator('button').filter({ hasText: /^create$|save|generate/i }).last();
          if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await saveBtn.click();
            await page.waitForTimeout(3000);
            console.log('[API] Saved key');
          }
        }
      } else {
        console.log('[API] Create API Key button not found');
      }

      await page.screenshot({ path: 'kapso-step13-apikey-result.png' });

      // Try to capture the API key from the page
      const keyPageText = await page.textContent('body').catch(() => '');
      const keyMatch = keyPageText.match(/([a-f0-9]{64})/);
      if (keyMatch) {
        console.log(`[API Key] ${keyMatch[1]}`);
      } else {
        console.log(`[API Key] Page text: ${keyPageText.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
    } else {
      console.log('[Nav] API keys link not found in sidebar');
    }

    // Capture any data we found
    let apiKey = null;
    try {
      const finalText = await page.textContent('body').catch(() => '');
      const km = finalText.match(/([a-f0-9]{64})/);
      if (km) apiKey = km[1];
    } catch {}

    // Save credentials
    const credentials = {
      email: mail.email,
      password: KAPSO_PASSWORD,
      mailTmToken: mail.token,
      createdAt: new Date().toISOString(),
      phone,
      projectId: projectId || null,
      apiKey: apiKey || null,
      kapsoUrl: KAPSO_URL,
      sandboxNumber: '+56920403095',
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
