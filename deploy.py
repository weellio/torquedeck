"""Deploy Torque Deck to obdii.bworldtools.com over FTPS.

Reads torquedeck_FTP_ID / torquedeck_FTP_PASSWORD (and torquedeck_FTP = the FTP host) from .env.
The FTP account is jailed: the login directory IS the site's web root, so we never cwd
to the absolute torquedeck_FTP_ROOT path (on these hosts it can point at a stale folder).

  python deploy.py --list      show what is on the server, change nothing
  python deploy.py             bump the sw.js cache version, then upload the app files
"""
import ftplib, os, re, ssl, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ['index.html', 'app.js', 'obd.js', 'mods.js', 'shop.js', 'sw.js', 'manifest.json',
         'maplibre-gl.js', 'maplibre-gl.css', 'icon-192.png', 'icon-512.png']
HTACCESS = ('dot-htaccess.txt', '.htaccess')


def env():
    vals = {}
    with open(os.path.join(HERE, '.env'), encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


def connect(cfg):
    host = cfg.get('torquedeck_FTP') or cfg.get('torquedeck_FTP_HOST') or 'ftp.obdii.bworldtools.com'
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
    # Hostinger serves its shared *.hstgr.io certificate on every customer FTP host, so the
    # hostname never matches. Still verify the CA chain, then require that exact cert name.
    ctx.check_hostname = False
    ftp = ftplib.FTP_TLS(host, timeout=30, context=ctx)
    ftp.auth()
    sans = [v for k, v in ftp.sock.getpeercert().get('subjectAltName', ()) if k == 'DNS']
    if '*.hstgr.io' not in sans:
        raise SystemExit(f'unexpected FTP certificate {sans}; refusing to send the password')
    ftp.login(cfg['torquedeck_FTP_ID'], cfg['torquedeck_FTP_PASSWORD'])
    ftp.prot_p()
    return ftp


def bump_cache():
    p = os.path.join(HERE, 'sw.js')
    s = open(p, encoding='utf-8').read()
    m = re.search(r"torque-deck-v(\d+)", s)
    new = f"torque-deck-v{int(m.group(1)) + 1}"
    open(p, 'w', encoding='utf-8', newline='\n').write(s.replace(m.group(0), new))
    return new


def main():
    cfg = env()
    ftp = connect(cfg)
    print('connected, pwd =', ftp.pwd())
    if '--list' in sys.argv:
        for name in ftp.nlst():
            print('  ', name)
        ftp.quit()
        return
    print('cache ->', bump_cache())
    for name in FILES:
        with open(os.path.join(HERE, name), 'rb') as f:
            ftp.storbinary('STOR ' + name, f)
        print('  uploaded', name)
    src, dst = HTACCESS
    with open(os.path.join(HERE, src), 'rb') as f:
        ftp.storbinary('STOR ' + dst, f)
    print('  uploaded', dst)
    ftp.quit()
    print('done: https://obdii.bworldtools.com  (hard-refresh on the phone)')


if __name__ == '__main__':
    main()
