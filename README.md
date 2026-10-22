# owl.red Guest Captive Portal

Astro and TypeScript presentation and Forward Authentication Service for the
`owl.red` guest network. No PHP. The original portal's satirical copy and local
artwork are retained; openNDS still owns network sessions and enforcement.

Image: `d0ntblink/owl.red-guest-captive-portal`, `linux/amd64`.

## Builds And Publishing

Pushes to `main` and manual Actions runs build, type-check, test and smoke-test
the nonroot container, then publish `latest` and `sha-<full-commit-sha>` to
Docker Hub. Pull requests build/test without registry secrets or publication.
Actions and the Node 24 base image are commit/digest pinned. Builds generate
provenance and an SBOM.

Repository Actions secret `DOCKERHUB_TOKEN` must hold a Docker Hub token
permitted to push this image as `d0ntblink`. Its source of truth is Bitwarden
Secrets Manager. Never place credentials in source, Docker build arguments or
chat. Publishing explicitly fails if the secret is absent.

Infrastructure, Technitium lease synchronization and gateway configuration stay
in [owl.red](https://github.com/d0ntblink/owl.red). Publishing an image does not
deploy it or activate guest DHCP/Wi-Fi. Pin an accepted image digest in the
infrastructure repository. This app has not yet passed native Authmon end-to-end
browser/device qualification; CI does not certify guest network enforcement.

## Runtime

- Node 24; port `4321`; `/health` checks the HTTP process.
- `PORTAL_ORIGIN`: canonical HTTPS origin, such as `https://guest.owl.red`.
- `GATEWAY_NAME`: exact native openNDS gateway name, default `owl.red guest`.
- `FAS_KEY_FILE`: mounted private file containing the same 64-character lowercase
  hex key configured as openNDS `faskey`. Never bake the key into the image.
- Native openNDS HTTPS FAS security level `4` and its Authmon daemon are required.
- One app replica: pending consent is bounded and volatile, expiring after 30
  seconds. Restarting loses pending requests rather than granting access.
- Consent uses signed, short-lived browser-bound offers. The signing key is
  derived separately from the FAS key. No name/email collection or external
  image-fetch endpoint is included.
- Runtime can use a read-only root filesystem, dropped capabilities, no-new-
  privileges, and a small writable `/tmp`. The container runs as the Node user.

Authmon calls use the same portal path with `auth_get`. They must pass a trusted
reverse proxy route restricted to the gateway, which overwrites `X-Owl-Authmon`
with `1`. Set `TRUST_AUTHMON_PROXY=true` only after that route is enforced.
The guest/public route must overwrite that header with `0`, including for
client-supplied headers. Do not expose the backend directly. Without the trusted
route enabled, all Authmon operations are denied. The gateway hash alone is not
authentication. A trusted proxy route is not deployed by this repository.

The confirmation page reports authentication only after native Authmon
acknowledges a pending consent request, never merely after the button is pressed.
It is not an ongoing gateway session-status API.

## Development

```bash
npm ci
npm test
npm run build
npm run dev
```

Open `http://127.0.0.1:4321`. Without a genuine gateway handoff and private runtime
key, the page does not offer an access grant. Fonts and artwork are served locally;
the portal requires no client-side JavaScript.