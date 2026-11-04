# Deploy: server on a GCP free VM, site on Vercel

The hosted demo has two parts:

| Part | Where | Address |
|---|---|---|
| Site (SvelteKit, prerendered) | Vercel | `https://coop.<your-domain>` (Cloudflare DNS record to Vercel) |
| Server (Fastify API, agent runtime, seller loop, settler) | Google Cloud `e2-micro` VM, Docker, Caddy in front | `https://<vm-ip-with-dashes>.sslip.io` |

The browser reads pools straight from NEAR RPC, so the site keeps working (read-only) even when the server is unreachable. The server adds the live feed, transaction hashes and "Spawn your agent".

## Decisions and tradeoffs

- **Always-on VM instead of a sleeping free tier.** The server is a long-running process (it polls the chain, joins pools, opens offers, settles). The GCP free tier includes one `e2-micro` VM that never sleeps and a persistent disk, so spawned agents' keys survive restarts. The cost is owning the machine: OS updates and the firewall are manual.
- **Docker for the server only.** The image is built on the VM from this repo with [server/Dockerfile](../server/Dockerfile). It runs as the non-root `node` user and uses plain Dockerfile syntax, so any Docker builder can build it.
- **Named volume for keys.** Spawned agents' keys live in the Docker volume `coop-data`, which Docker creates owned by the container user. A bind-mounted host folder works too, but only if it is owned by uid 1000; with the wrong owner, spawning creates the agent on chain and then fails to save its keys.
- **Caddy for HTTPS.** The site is served over HTTPS, so browsers block calls to a plain-HTTP API. Caddy gets and renews a certificate automatically. `sslip.io` turns the VM's IP into a hostname (`34-1-2-3.sslip.io` resolves to `34.1.2.3`), so no DNS record is needed for the server.
- **The server listens on localhost only.** Docker publishes port 8787 on `127.0.0.1`, so only Caddy can reach it, and `TRUST_PROXY=1` makes the per-IP limits use the client address Caddy forwards.
- **Vercel for the site.** It stays up when the VM restarts. The SvelteKit app uses `@sveltejs/adapter-vercel` ([web/vite.config.ts](../web/vite.config.ts)).

## Files

- To find the image build visit [server/Dockerfile](../server/Dockerfile); the build context rules are in [.dockerignore](../.dockerignore).
- To find the HTTPS reverse proxy config visit [Caddyfile](Caddyfile).
- To find the server settings used on the VM visit [server.env.example](server.env.example).
- The server itself can be found in [server/src/index.ts](../server/src/index.ts); its settings and defaults are in [server/src/settings.ts](../server/src/settings.ts).
- The spawned-agent key store can be found in [server/src/store.ts](../server/src/store.ts).

## 1. Create the VM (Google Cloud console)

1. Create a project and attach a billing account. Google requires one even for free-tier use; the free tier is billed at zero while usage stays within its limits.
2. **Compute Engine > VM instances > Create instance**:
   - Region: `us-central1`, `us-west1` or `us-east1` (the only free-tier regions).
   - Machine type: `e2-micro`.
   - Boot disk: **Debian 13**, disk type **Standard persistent disk**, 30 GB. The default "Balanced" disk is not covered by the free tier.
   - Firewall: tick **Allow HTTP traffic** and **Allow HTTPS traffic**.
3. **VPC network > IP addresses**: find the VM's external address and choose **Promote to static IP address**, so the `sslip.io` name does not change if the VM is stopped and started.
4. Open an SSH session from the VM list (**SSH** button).

## 2. Prepare the VM

A 1 GB swap file keeps the `pnpm install` inside `docker build` from running out of memory on the 1 GB machine:

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Docker Engine from Docker's apt repository ([docs](https://docs.docker.com/engine/install/debian/)):

```bash
sudo apt update && sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
```

Caddy from its official repository ([docs](https://caddyserver.com/docs/install)):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 3. Build and start the server

```bash
git clone https://github.com/AlphaTechini/co-op.git && cd co-op
sudo docker build -f server/Dockerfile -t coop-server .

sudo install -d -m 700 /etc/coop
sudo install -m 600 deploy/server.env.example /etc/coop/server.env
sudo nano /etc/coop/server.env    # operator account, key, contract ids, CORS_ORIGIN=https://coop.<your-domain>

sudo docker run -d --name coop-server --restart unless-stopped \
  --env-file /etc/coop/server.env \
  -p 127.0.0.1:8787:8787 \
  -v coop-data:/data \
  coop-server
curl -s http://127.0.0.1:8787/api/health
```

The private key sits in `/etc/coop/server.env` in plain text (readable by root only). Use a testnet-only account.

## 4. Turn on HTTPS

```bash
IP=$(curl -s -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)
API_HOST="${IP//./-}.sslip.io"
sed "s/API_HOST/$API_HOST/" deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -s "https://$API_HOST/api/health"; echo "API URL: https://$API_HOST"
```

The first request can take a few seconds while Caddy obtains the certificate.

## 5. Deploy the site on Vercel

1. **Add New > Project**, import the GitHub repository, set **Root Directory** to `web`. Vercel detects SvelteKit and pnpm from the lockfile.
2. Environment variables (all public, baked into the build):
   - `PUBLIC_NETWORK=testnet`
   - `PUBLIC_RPC_URL=https://test.rpc.fastnear.com`
   - `PUBLIC_COOP_CONTRACT_ID=<coop contract id>`
   - `PUBLIC_API_URL=https://<vm-ip-with-dashes>.sslip.io`
3. Deploy, then **Settings > Domains > Add** `coop.<your-domain>`. In Cloudflare DNS, add the record Vercel shows (a CNAME for `coop`) with the proxy **off** (grey cloud), so Vercel can issue its certificate.

## Updating and operating

| Task | Command |
|---|---|
| Deploy a new commit | `git pull && sudo docker build -f server/Dockerfile -t coop-server . && sudo docker rm -f coop-server`, then the `docker run` command from step 3 |
| Logs | `sudo docker logs -f coop-server` |
| Change a setting | edit `/etc/coop/server.env`, then recreate the container (as above) |
| OS updates | `sudo apt update && sudo apt upgrade` |

Recreating the container keeps the `coop-data` volume and therefore the spawned agents. `docker volume rm coop-data` deletes their keys for good.

Not tested from the build environment: the GCP console steps, Caddy on the VM and the Vercel deployment. The image itself was built and run against a local sandbox (health, config, live stream, spawn, and resume after recreating the container on the same volume).
