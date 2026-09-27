import tls from 'node:tls';
import crypto from 'node:crypto';

/**
 * GuideTalk Production Mailer Service
 * Powered by Gmail SMTP (tls port 465) with zero external dependency requirements,
 * while automatically integrating with nodemailer if present.
 */

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = (process.env.SMTP_USER || 'guidetalk.app@gmail.com').trim();
// Strip any whitespace from Gmail App Password (e.g. "qkav horg qdka mtip" -> "qkavhorgqdkamtip")
const SMTP_PASS = (process.env.SMTP_PASS || '').replace(/\s+/g, '').trim();

/**
 * Sends an email using native Node.js TLS socket over SMTP.
 */
function sendNativeSmtp({ to, subject, html, text }) {
  return new Promise((resolve, reject) => {
    if (!SMTP_USER || !SMTP_PASS) {
      return reject(new Error('SMTP credentials are not configured in server/.env'));
    }

    const socket = tls.connect(
      {
        host: SMTP_HOST,
        port: SMTP_PORT,
        rejectUnauthorized: true,
      },
      () => {
        // Connected to SMTPS server
      }
    );

    let stage = 0;
    let responseBuffer = '';

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP connection timed out.'));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      socket.destroy();
    }

    socket.on('error', (err) => {
      cleanup();
      reject(err);
    });

    socket.on('data', (chunk) => {
      responseBuffer += chunk.toString();

      // Check if server completed response (format: "XXX ..." or "XXX\r\n")
      const lines = responseBuffer.split('\r\n');
      const lastLine = lines[lines.length - 2] || lines[lines.length - 1];

      // Multi-line SMTP responses have "-" after code (e.g. "250-SIZE"). Complete line has space or ends.
      if (!/^\d{3}\s/.test(lastLine) && !/^\d{3}$/.test(lastLine.trim())) {
        return;
      }

      const code = parseInt(lastLine.slice(0, 3), 10);
      responseBuffer = ''; // reset buffer for next command

      try {
        switch (stage) {
          case 0: // Expecting 220 greeting
            if (code !== 220) throw new Error(`Unexpected greeting: ${lastLine}`);
            stage = 1;
            socket.write(`EHLO localhost\r\n`);
            break;

          case 1: // Expecting 250 after EHLO
            if (code !== 250) throw new Error(`EHLO failed: ${lastLine}`);
            stage = 2;
            socket.write(`AUTH LOGIN\r\n`);
            break;

          case 2: // Expecting 334 for username
            if (code !== 334) throw new Error(`AUTH LOGIN rejected: ${lastLine}`);
            stage = 3;
            socket.write(`${Buffer.from(SMTP_USER).toString('base64')}\r\n`);
            break;

          case 3: // Expecting 334 for password
            if (code !== 334) throw new Error(`Username rejected: ${lastLine}`);
            stage = 4;
            socket.write(`${Buffer.from(SMTP_PASS).toString('base64')}\r\n`);
            break;

          case 4: // Expecting 235 (Authentication succeeded)
            if (code !== 235) throw new Error(`Authentication failed (${lastLine}). Please verify Gmail App Password.`);
            stage = 5;
            socket.write(`MAIL FROM:<${SMTP_USER}>\r\n`);
            break;

          case 5: // Expecting 250 after MAIL FROM
            if (code !== 250) throw new Error(`MAIL FROM failed: ${lastLine}`);
            stage = 6;
            socket.write(`RCPT TO:<${to}>\r\n`);
            break;

          case 6: // Expecting 250 after RCPT TO
            if (code !== 250) throw new Error(`RCPT TO failed for ${to}: ${lastLine}`);
            stage = 7;
            socket.write(`DATA\r\n`);
            break;

          case 7: // Expecting 354 to begin data stream
            if (code !== 354) throw new Error(`DATA command rejected: ${lastLine}`);
            stage = 8;

            const boundary = `====_GuideTalk_${Date.now()}_${crypto.randomBytes(8).toString('hex')}====`;
            const rawMessage = [
              `From: "GuideTalk" <${SMTP_USER}>`,
              `To: <${to}>`,
              `Subject: ${subject}`,
              `Date: ${new Date().toUTCString()}`,
              `Message-ID: <${Date.now()}.${crypto.randomBytes(8).toString('hex')}@guidetalk.app>`,
              `MIME-Version: 1.0`,
              `Content-Type: multipart/alternative; boundary="${boundary}"`,
              ``,
              `--${boundary}`,
              `Content-Type: text/plain; charset=utf-8`,
              `Content-Transfer-Encoding: 7bit`,
              ``,
              text || html.replace(/<[^>]+>/g, ''),
              ``,
              `--${boundary}`,
              `Content-Type: text/html; charset=utf-8`,
              `Content-Transfer-Encoding: 7bit`,
              ``,
              html,
              ``,
              `--${boundary}--`,
              ``,
              `.`,
              ``,
            ].join('\r\n');

            socket.write(rawMessage);
            break;

          case 8: // Expecting 250 (Message queued/sent)
            if (code !== 250) throw new Error(`Message data rejected: ${lastLine}`);
            stage = 9;
            socket.write(`QUIT\r\n`);
            break;

          case 9: // Expecting 221 (Bye)
            cleanup();
            resolve({ success: true, messageId: lastLine });
            break;

          default:
            cleanup();
            resolve({ success: true });
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  });
}

/**
 * Builds a luxury, high-conversion HTML verification email template.
 */
export function buildVerificationEmailHtml({ code, name, expiresMinutes = 10 }) {
  const safeName = (name || '').trim() || 'Companion Traveler';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GuideTalk Verification Code</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #0b0b12;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #FFFFFF;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #0b0b12;
      padding: 40px 0;
    }
    .container {
      max-width: 560px;
      margin: 0 auto;
      background: linear-gradient(180deg, #161526 0%, #100f1c 100%);
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    }
    .header-banner {
      background: linear-gradient(135deg, #0A84FF 0%, #5E5CE6 50%, #BF5AF2 100%);
      padding: 32px 24px;
      text-align: center;
    }
    .logo-text {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: -0.5px;
      color: #FFFFFF;
      margin: 0;
      text-transform: uppercase;
    }
    .logo-subtitle {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.85);
      margin-top: 6px;
      letter-spacing: 0.5px;
    }
    .content {
      padding: 36px 32px;
    }
    .greeting {
      font-size: 18px;
      font-weight: 700;
      color: #FFFFFF;
      margin-bottom: 12px;
    }
    .message {
      font-size: 14px;
      line-height: 22px;
      color: #A1A1AA;
      margin-bottom: 28px;
    }
    .code-box {
      background: rgba(10, 132, 255, 0.08);
      border: 1.5px dashed rgba(10, 132, 255, 0.4);
      border-radius: 18px;
      padding: 24px;
      text-align: center;
      margin: 24px 0;
    }
    .code-label {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #0A84FF;
      margin-bottom: 8px;
    }
    .code-digits {
      font-family: 'Courier New', Courier, monospace;
      font-size: 38px;
      font-weight: 900;
      letter-spacing: 10px;
      color: #FFFFFF;
      text-shadow: 0 2px 10px rgba(10, 132, 255, 0.5);
    }
    .expiry-note {
      font-size: 12px;
      color: #FF9F0A;
      margin-top: 10px;
      font-weight: 600;
    }
    .security-notice {
      background: rgba(255, 255, 255, 0.04);
      border-radius: 12px;
      padding: 14px 18px;
      font-size: 12px;
      line-height: 18px;
      color: #71717A;
      margin-top: 24px;
    }
    .footer {
      padding: 24px 32px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      text-align: center;
      font-size: 11px;
      color: #52525B;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header-banner">
        <h1 class="logo-text">GuideTalk</h1>
        <div class="logo-subtitle">Authentic AI Companions & Living Storylines</div>
      </div>
      <div class="content">
        <div class="greeting">Greetings, ${safeName}!</div>
        <div class="message">
          We are upgrading GuideTalk to production accounts. To protect your characters, storyline memories, and personal settings, please verify your email address.
        </div>

        <div class="code-box">
          <div class="code-label">Your Verification Code</div>
          <div class="code-digits">${code}</div>
          <div class="expiry-note">⏱ Code expires in ${expiresMinutes} minutes</div>
        </div>

        <div class="message" style="margin-bottom: 0;">
          Enter this 6-digit code in the GuideTalk app to complete verification and unlock native Face ID / Touch ID passkey login.
        </div>

        <div class="security-notice">
          <strong>Security Tip:</strong> Never share this code with anyone. GuideTalk staff will never ask for your verification code. If you did not request this, you can safely ignore this email.
        </div>
      </div>
      <div class="footer">
        © ${new Date().getFullYear()} GuideTalk Inc. All rights reserved.<br>
        Sent securely from guidetalk.app@gmail.com
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Main send verification email method.
 */
export async function sendVerificationEmail({ to, code, name }) {
  const cleanTo = (to || '').trim().toLowerCase();
  if (!cleanTo || !cleanTo.includes('@')) {
    throw new Error('Valid recipient email address is required.');
  }

  const subject = `Your GuideTalk Verification Code: ${code}`;
  const html = buildVerificationEmailHtml({ code, name });
  const text = `Your GuideTalk verification code is: ${code}. This code expires in 10 minutes.`;

  return sendNativeSmtp({
    to: cleanTo,
    subject,
    html,
    text,
  });
}
