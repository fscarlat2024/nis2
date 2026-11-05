#!/usr/bin/env python3
"""Semnare iOS in CI fara Mac si fara dispozitiv inregistrat, prin App Store Connect API.

  setup   - foloseste certificatul Apple Distribution PERMANENT (secretele IOS_DIST_P12_B64 / IOS_DIST_P12_PASSWORD),
            creeaza profilul IOS_APP_STORE si le instaleaza (keychain temporar + Provisioning Profiles). Scrie numele profilului in $GITHUB_ENV.
  cleanup - NU mai revoca nimic: un build aflat in review cu certificat revocat e respins (ITMS-90035
            Invalid Signature, 20 oct 2026). Certificatul e permanent si nu se mai revoca din CI.

Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, BUNDLE_ID, RUNNER_TEMP.
"""
import base64, json, os, subprocess, sys, time, urllib.parse, urllib.request, urllib.error
import jwt  # pyjwt[crypto]

API = "https://api.appstoreconnect.apple.com/v1"
TMP = os.environ.get("RUNNER_TEMP", "/tmp")
STATE = os.path.join(TMP, "signing_state.json")
PROFILE_NAME = "CI AppStore " + os.environ.get("BUNDLE_ID", "")


def token():
    key = open(os.environ["ASC_KEY_PATH"]).read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 1000, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})


def api(method, path, body=None):
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")
        print(f"::error title=ASC API {method} {path}::{e.code} {msg[:800]}")
        raise


def sh(*cmd, **kw):
    subprocess.run(cmd, check=True, **kw)


def setup():
    bundle = os.environ["BUNDLE_ID"]
    p12_b64 = os.environ.get("IOS_DIST_P12_B64", "").strip()
    if not p12_b64:
        print("::error title=certificat::Lipseste secretul IOS_DIST_P12_B64 (certificatul permanent din .ios-keys)")
        sys.exit(1)
    # certificatul permanent Apple Distribution (creat o singura data, vezi .ios-keys/CITESTE.txt);
    # NU se mai creeaza / revoca certificate in CI: revocarea invalideaza build-urile aflate in review (ITMS-90035)
    p12 = os.path.join(TMP, "dist.p12")
    p12pw = os.environ.get("IOS_DIST_P12_PASSWORD", "").strip()
    open(p12, "wb").write(base64.b64decode(p12_b64))
    pem = subprocess.run(["openssl", "pkcs12", "-in", p12, "-nokeys", "-clcerts", "-passin", "pass:" + p12pw, "-legacy"],
                         capture_output=True, text=True)
    if pem.returncode != 0:
        pem = subprocess.run(["openssl", "pkcs12", "-in", p12, "-nokeys", "-clcerts", "-passin", "pass:" + p12pw],
                             capture_output=True, text=True, check=True)
    der = subprocess.run(["openssl", "x509", "-outform", "DER"], input=pem.stdout.encode(), capture_output=True, check=True).stdout
    content = base64.b64encode(der).decode()
    cert_id = next((c["id"] for c in api("GET", "/certificates?filter[certificateType]=DISTRIBUTION&limit=50")["data"]
                    if c["attributes"].get("certificateContent") == content), None)
    if not cert_id:
        print("::error title=certificat::Certificatul din IOS_DIST_P12_B64 nu mai exista la Apple (revocat/expirat)")
        sys.exit(1)

    bids = api("GET", "/bundleIds?filter[identifier]=" + bundle)["data"]
    bid = next(b["id"] for b in bids if b["attributes"]["identifier"] == bundle)

    # profilul are nume fix (referit in project.pbxproj); il inlocuim - stergerea profilului nu invalideaza
    # build-urile deja urcate, doar revocarea certificatului o face
    for p in api("GET", "/profiles?filter[name]=" + urllib.parse.quote(PROFILE_NAME))["data"]:
        api("DELETE", "/profiles/" + p["id"])
    prof = api("POST", "/profiles", {"data": {"type": "profiles",
               "attributes": {"name": PROFILE_NAME, "profileType": "IOS_APP_STORE"},
               "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bid}},
                                 "certificates": {"data": [{"type": "certificates", "id": cert_id}]}}}})["data"]
    st = {"cert_id": cert_id, "profile_id": prof["id"]}
    json.dump(st, open(STATE, "w"))
    content = base64.b64decode(prof["attributes"]["profileContent"])
    uuid = prof["attributes"]["uuid"]
    for d in ["~/Library/MobileDevice/Provisioning Profiles", "~/Library/Developer/Xcode/UserData/Provisioning Profiles"]:
        d = os.path.expanduser(d)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, uuid + ".mobileprovision"), "wb").write(content)

    # keychain temporar cu certificatul permanent
    kc, kcpw = os.path.join(TMP, "ci.keychain-db"), "ci-" + str(os.getpid())
    sh("security", "create-keychain", "-p", kcpw, kc)
    sh("security", "set-keychain-settings", "-lut", "21600", kc)
    sh("security", "unlock-keychain", "-p", kcpw, kc)
    sh("security", "import", p12, "-k", kc, "-P", p12pw, "-T", "/usr/bin/codesign", "-T", "/usr/bin/security")
    sh("security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", kcpw, kc, stdout=subprocess.DEVNULL)
    existing = subprocess.run(["security", "list-keychains", "-d", "user"], capture_output=True, text=True).stdout.split()
    sh("security", "list-keychains", "-d", "user", "-s", kc, *[e.strip('"') for e in existing])
    os.remove(p12)
    with open(os.environ["GITHUB_ENV"], "a") as g:
        g.write(f"PROFILE_NAME={PROFILE_NAME}\nPROFILE_UUID={uuid}\n")
    print("Certificat", cert_id, "profil", uuid, "instalate")


def cleanup():
    # intentionat nu revocam certificatul si nu stergem profilul (vezi docstring)
    if os.path.exists(STATE):
        os.remove(STATE)


if __name__ == "__main__":
    {"setup": setup, "cleanup": cleanup}[sys.argv[1]]()
