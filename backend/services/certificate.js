const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function generateCertificate({ domain, email, type = 'letsencrypt' }) {
  if (type === 'selfsigned') {
    return generateSelfSigned(domain);
  }
  return generateLetsEncrypt(domain, email);
}

async function generateLetsEncrypt(domain, email) {
  try {
    // Check if certbot is installed
    try {
      execSync('which certbot', { stdio: 'ignore' });
    } catch {
      execSync('apt-get install -y certbot 2>/dev/null || yum install -y certbot 2>/dev/null', { timeout: 60000 });
    }
    
    // Stop any service on port 80 temporarily
    execSync('systemctl stop nginx 2>/dev/null; systemctl stop apache2 2>/dev/null; true', { stdio: 'ignore' });
    
    // Generate certificate
    execSync(
      `certbot certonly --standalone --non-interactive --agree-tos --email ${email} -d ${domain}`,
      { timeout: 120000, stdio: 'pipe' }
    );
    
    const certPath = `/etc/letsencrypt/live/${domain}`;
    
    return {
      success: true,
      type: 'letsencrypt',
      domain,
      cert_path: `${certPath}/fullchain.pem`,
      key_path: `${certPath}/privkey.pem`,
      expires_at: getCertExpiry(`${certPath}/fullchain.pem`)
    };
  } catch (error) {
    throw new Error(`Let's Encrypt certificate generation failed: ${error.message}`);
  }
}

async function generateSelfSigned(domain) {
  try {
    const certDir = `/etc/pahlavy/certs/${domain}`;
    execSync(`mkdir -p ${certDir}`, { stdio: 'ignore' });
    
    execSync(
      `openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
       -keyout ${certDir}/privkey.pem \
       -out ${certDir}/fullchain.pem \
       -subj "/C=US/ST=State/L=City/O=Pahlavy/CN=${domain}" \
       2>/dev/null`,
      { timeout: 30000 }
    );
    
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
