const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function generateCertificate({ domain, type = 'letsencrypt' }) {
  if (type === 'selfsigned') {
    return generateSelfSigned(domain);
  }
  return generateLetsEncrypt(domain);
}

async function generateLetsEncrypt(domain) {
  try {
    // Check if certbot or acme.sh is installed
    try {
      execSync('which certbot 2>/dev/null || which acme.sh 2>/dev/null', { stdio: 'ignore' });
    } catch {
      execSync('apt-get install -y certbot 2>/dev/null || yum install -y certbot 2>/dev/null', { timeout: 60000 });
    }
    
    // Stop any service on port 80 temporarily
    execSync('systemctl stop nginx 2>/dev/null; systemctl stop apache2 2>/dev/null; true', { stdio: 'ignore' });
    
    // Generate certificate via standalone without email (Sanaei 3X-UI style)
    let certbotSuccess = false;
    try {
      execSync(
        `certbot certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email -d ${domain}`,
        { timeout: 90000, stdio: 'pipe' }
      );
      certbotSuccess = true;
    } catch (e) {
      // If certbot fails (e.g. Cloudflare proxy or DNS propagation), log and prepare fallback
      console.warn(`Certbot standalone verification note for ${domain}:`, e.message);
    }
    
    const certPath = `/etc/letsencrypt/live/${domain}`;
    const activeDir = `/etc/pahlavy/certs/active`;

    if (certbotSuccess && fs.existsSync(`${certPath}/fullchain.pem`)) {
      try {
        execSync(`mkdir -p ${activeDir} /etc/pahlavy/certs/${domain}`, { stdio: 'ignore' });
        execSync(`cp -f ${certPath}/fullchain.pem ${activeDir}/fullchain.pem && cp -f ${certPath}/privkey.pem ${activeDir}/privkey.pem`, { stdio: 'ignore' });
        execSync(`cp -f ${certPath}/fullchain.pem /etc/pahlavy/certs/${domain}/fullchain.pem && cp -f ${certPath}/privkey.pem /etc/pahlavy/certs/${domain}/privkey.pem`, { stdio: 'ignore' });
      } catch {}

      return {
        success: true,
        type: 'letsencrypt',
        domain,
        cert_path: `${activeDir}/fullchain.pem`,
        key_path: `${activeDir}/privkey.pem`,
        expires_at: getCertExpiry(`${activeDir}/fullchain.pem`)
      };
    } else {
      // Auto fallback to self-signed so panel HTTPS keeps running without error
      console.log(`Auto-generating self-signed fallback certificate for ${domain}...`);
      const fallbackResult = await generateSelfSigned(domain);
      return {
        ...fallbackResult,
        is_fallback: true,
        message: 'Let\'s Encrypt verification on port 80 was not reached (check DNS/Cloudflare Proxy). Activated Self-Signed SSL as fallback.'
      };
    }
  } catch (error) {
    throw new Error(`SSL certificate generation failed: ${error.message}`);
  }
}

async function generateSelfSigned(domain) {
  try {
    const certDir = `/etc/pahlavy/certs/${domain}`;
    const activeDir = `/etc/pahlavy/certs/active`;
    execSync(`mkdir -p ${certDir} ${activeDir}`, { stdio: 'ignore' });
    
    execSync(
      `openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
       -keyout ${certDir}/privkey.pem \
       -out ${certDir}/fullchain.pem \
       -subj "/C=US/ST=State/L=City/O=Pahlavy/CN=${domain}" \
       2>/dev/null`,
      { timeout: 30000 }
    );
    
    execSync(`cp -f ${certDir}/privkey.pem ${activeDir}/privkey.pem && cp -f ${certDir}/fullchain.pem ${activeDir}/fullchain.pem`, { stdio: 'ignore' });

    return {
      success: true,
      type: 'selfsigned',
      domain,
      cert_path: `${certDir}/fullchain.pem`,
      key_path: `${certDir}/privkey.pem`,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    };
  } catch (error) {
    throw new Error(`Self-signed certificate generation failed: ${error.message}`);
  }
}

function getCertExpiry(certPath) {
  try {
    const output = execSync(`openssl x509 -noout -enddate -in ${certPath}`).toString();
    const match = output.match(/notAfter=(.+)/);
    if (match) {
      return new Date(match[1]).toISOString();
    }
  } catch {}
  return null;
}

async function getCertStatus(domain) {
  const paths = [
    `/etc/letsencrypt/live/${domain}/fullchain.pem`,
    `/etc/pahlavy/certs/${domain}/fullchain.pem`
  ];
  
  for (const certPath of paths) {
    if (fs.existsSync(certPath)) {
      const expiry = getCertExpiry(certPath);
      const expiryDate = expiry ? new Date(expiry) : null;
      const daysLeft = expiryDate ? Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24)) : 0;
      
      return {
        status: daysLeft > 0 ? 'valid' : 'expired',
        domain,
        cert_path: certPath,
        expires_at: expiry,
        days_left: daysLeft,
        is_letsencrypt: certPath.includes('letsencrypt')
      };
    }
  }
  
  return {
    status: 'none',
    domain,
    cert_path: null,
    expires_at: null,
    days_left: 0
  };
}

module.exports = { generateCertificate, getCertStatus };
