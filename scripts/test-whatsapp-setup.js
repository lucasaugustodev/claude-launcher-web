/**
 * Playwright test for WhatsApp setup integration in Claude Launcher
 * Tests: Open config, click Vincular, enter phone, verify setup starts
 */

const { chromium } = require('playwright');

const LAUNCHER_URL = 'http://localhost:3002';
const TEST_PHONE = '+556198515960';

async function test() {
  console.log('[Test] Starting WhatsApp setup integration test');
  console.log(`[Test] Phone: ${TEST_PHONE}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    // Step 1: Open the launcher
    console.log('\n=== Step 1: Open Launcher ===');
    await page.goto(LAUNCHER_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test-wa-01-initial.png' });
    console.log(`[Test] Page loaded: ${page.url()}`);

    // Step 2: Navigate to config page
    console.log('\n=== Step 2: Navigate to Config ===');
    // Look for config/settings button in the UI
    const configLink = page.locator('a, button, [role="tab"]').filter({ hasText: /config|configurac|settings/i }).first();
    if (await configLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await configLink.click();
      await page.waitForTimeout(2000);
      console.log('[Test] Clicked config link');
    } else {
      console.log('[Test] No config link found, may already be on config page or need different nav');
      // Try sidebar/nav items
      const navItems = await page.locator('nav a, .sidebar a, .nav-item').allTextContents();
      console.log(`[Test] Nav items: ${navItems.join(', ')}`);
    }
    await page.screenshot({ path: 'test-wa-02-config.png' });

    // Step 3: Find WhatsApp card
    console.log('\n=== Step 3: Find WhatsApp Card ===');
    const waCard = page.locator('text=WhatsApp').first();
    if (await waCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[Test] WhatsApp card found');
    } else {
      console.log('[Test] WhatsApp card NOT found on page');
      const bodyText = await page.textContent('body').catch(() => '');
      console.log(`[Test] Page text: ${bodyText.replace(/\s+/g, ' ').slice(0, 500)}`);
    }
    await page.screenshot({ path: 'test-wa-03-whatsapp-card.png' });

    // Step 4: Click "Vincular" button
    console.log('\n=== Step 4: Click Vincular ===');
    const vincularBtn = page.locator('button').filter({ hasText: /vincular|sincronizar/i }).first();
    if (await vincularBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await vincularBtn.click();
      await page.waitForTimeout(1000);
      console.log('[Test] Clicked Vincular');
    } else {
      console.log('[Test] Vincular button not found');
    }
    await page.screenshot({ path: 'test-wa-04-after-vincular.png' });

    // Step 5: Type phone number
    console.log('\n=== Step 5: Enter phone number ===');
    const phoneInput = page.locator('input[type="tel"]').first();
    if (await phoneInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await phoneInput.fill(TEST_PHONE);
      console.log(`[Test] Typed phone: ${TEST_PHONE}`);
      await page.screenshot({ path: 'test-wa-05-phone-entered.png' });

      // Click the Vincular button inside the form
      const submitBtn = page.locator('button').filter({ hasText: /vincular/i }).first();
      if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await submitBtn.click();
        console.log('[Test] Clicked Submit');
      }
    } else {
      console.log('[Test] Phone input not found');
    }

    // Step 6: Wait for setup progress
    console.log('\n=== Step 6: Wait for setup ===');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test-wa-06-setup-progress.png' });

    // Check for "Configurando" text
    const settingUp = await page.textContent('body').catch(() => '');
    if (settingUp.includes('Configurando') || settingUp.includes('automaticamente')) {
      console.log('[Test] Setup is running!');
    } else {
      console.log('[Test] Setup text not found on page');
    }

    // Step 7: Wait longer for setup to complete (up to 3 minutes)
    console.log('\n=== Step 7: Wait for completion (up to 3min) ===');
    let completed = false;
    for (let i = 0; i < 36; i++) { // 36 * 5s = 3 minutes
      await page.waitForTimeout(5000);
      const text = await page.textContent('body').catch(() => '');

      if (text.includes('codigo') || text.includes('Envie') || text.includes('ativacao') || text.includes('activation')) {
        console.log(`[Test] Activation code found on page! (after ${(i+1)*5}s)`);
        completed = true;
        break;
      }
      if (text.includes('Erro') || text.includes('error')) {
        console.log(`[Test] Error detected on page after ${(i+1)*5}s`);
        break;
      }
      if (i % 6 === 0) {
        console.log(`[Test] Still waiting... ${(i+1)*5}s elapsed`);
        await page.screenshot({ path: `test-wa-07-waiting-${i}.png` });
      }
    }

    await page.screenshot({ path: 'test-wa-08-final.png' });

    if (completed) {
      // Extract the activation code from the page
      const finalText = await page.textContent('body').catch(() => '');
      const codeMatch = finalText.match(/([A-Z]{6})/);
      if (codeMatch) {
        console.log(`\n[Test] ACTIVATION CODE: ${codeMatch[1]}`);
        console.log(`[Test] Send "${codeMatch[1]}" to the sandbox number via WhatsApp to complete`);
      }
    }

    console.log('\n=== Test Complete ===');

  } catch (err) {
    console.error('[Test Error]', err.message);
    await page.screenshot({ path: 'test-wa-error.png' }).catch(() => {});
  } finally {
    await browser.close();
  }
}

test().catch(console.error);
