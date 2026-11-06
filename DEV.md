# Dev quick start

1. Serve locally (localhost is a secure context, so Bluetooth/GPS/SW work on desktop Chrome):
   python -m http.server 5512
   # then open http://localhost:5512

2. No adapter? Click "Try demo car" for a full simulated ELM327.

3. Engine unit tests (Node, no browser needed):
   node -e "const O=require('./obd.js'); console.log(O.decodePid('0C','410C1AF8'), O.decodeVin('1HGLM58718LA00000'))"

4. Deploy to odbii.bworldtools.com:
   python deploy.py          # bumps the sw.js cache version, uploads over FTPS (.env creds)
   python deploy.py --list   # read-only: show what is on the server
   Then hard-refresh on the phone.

See CLAUDE.md for the full architecture and conventions.
