const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const hostname = '127.0.0.1';
const port = 3000;
const rootDir = __dirname;

function loadEnvFile() {
  const candidates = ['.env.local', '.env'];
  candidates.forEach((fileName) => {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) return;

    const contents = fs.readFileSync(filePath, 'utf8');
    contents.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) return;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    });
  });
}

loadEnvFile();

function buildEmailTemplate(data) {
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #0f172a; }
      .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
      .header { border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
      .header h2 { margin: 0; color: #1e3a8a; font-size: 20px; }
      .field { margin-bottom: 16px; }
      .label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 4px; letter-spacing: 0.5px; }
      .value { font-size: 15px; color: #0f172a; background: #f1f5f9; padding: 12px 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
      .footer { font-size: 12px; color: #94a3b8; margin-top: 32px; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 16px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h2>New Student Inquiry — White Collars</h2>
      </div>
      <div class="field">
        <div class="label">Full Name</div>
        <div class="value">${escapeHtml(data.fullName)}</div>
      </div>
      <div class="field">
        <div class="label">Email Address</div>
        <div class="value"><a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></div>
      </div>
      <div class="field">
        <div class="label">Phone Number</div>
        <div class="value"><a href="tel:${escapeHtml(data.phone)}">${escapeHtml(data.phone)}</a></div>
      </div>
      <div class="field">
        <div class="label">Interested Course</div>
        <div class="value">${escapeHtml(data.interestedCourse)}</div>
      </div>
      <div class="field">
        <div class="label">Message / Goals</div>
        <div class="value">${escapeHtml(data.message)}</div>
      </div>
      <div class="footer">Automated notification from White Collars Website Form.</div>
    </div>
  </body>
</html>`;
}

function sendInquiryEmail(data) {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    return Promise.reject(new Error('BREVO_API_KEY is not configured.'));
  }

  const payload = JSON.stringify({
    sender: {
      name: 'White Collars Website Inquiry',
      email: 'inquiry@thewhitecollars.com',
    },
    to: [
      {
        email: 'hr@thewhitecollars.com',
        name: 'Hr Department White Collars',
      },
    ],
    replyTo: {
      email: data.email,
      name: data.fullName,
    },
    subject: `New Inquiry: ${data.interestedCourse} - ${data.fullName}`,
    htmlContent: buildEmailTemplate(data),
  });

  const options = {
    hostname: 'api.brevo.com',
    port: 443,
    path: '/v3/smtp/email',
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseBody));
        } else {
          reject(new Error(`Brevo request failed with ${res.statusCode}: ${responseBody}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const route = requestUrl.pathname;

  if (req.method === 'GET' && route === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Inquiry service is running.' }));
    return;
  }

  if (req.method === 'POST' && (route === '/api/inquiry' || route === '/api/send-inquiry')) {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { fullName, email, phone, interestedCourse, message } = payload;

        if (!fullName || !email || !phone || !interestedCourse || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'All fields are required.' }));
          return;
        }

        await sendInquiryEmail({ fullName, email, phone, interestedCourse, message });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Inquiry sent successfully.' }));
      } catch (error) {
        console.error('Inquiry submission failed:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message || 'Unable to send inquiry right now.' }));
      }
    });

    return;
  }

  let filePath = rootDir + route;
  if (filePath === rootDir + '/') {
    filePath = path.join(rootDir, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  }[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
