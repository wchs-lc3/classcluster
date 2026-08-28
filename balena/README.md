# LC3 worker on balenaOS

A worker is a Raspberry Pi that grades submissions, hosts interactive Java
runs, and serves the heavy browser runtimes to students. This directory turns
that into a balena fleet: flash once, and every device joins the cluster by
itself and is configured from the balenaCloud dashboard.

What changes compared with the SSH-provisioned Arch worker:

- No provisioning from the teacher's admin view. A device registers itself with
  the gateway's heartbeat endpoint, so "Add worker" over SSH is not used for
  balena devices. They appear in the admin list once they check in.
- The worker id defaults to the balena device UUID, so one fleet-wide set of
  variables is enough; nothing is per-device unless you want it to be.
- No systemd inside the container, so a job's memory, task, and CPU caps come
  from shell rlimits plus the container's own `mem_limit`/`pids_limit` instead
  of a `systemd-run` scope. The sandbox is unchanged: `bwrap` still gives every
  job its own mount, pid, and network namespace with the job directory as the
  only writable path.

## 1. Build and deploy

    balena login
    balena fleet create lc3-workers --type raspberrypi3-64
    cd <repo root>          # the directory holding docker-compose.yml
    balena push lc3-workers

For a 32-bit fleet (`raspberrypi3`), build with
`balena push lc3-workers --buildArg BASE_IMAGE=balenalib/armv7hf-debian:bookworm-run`.

Flash a device with the fleet's image (`balena os download`, or the download
button in the dashboard) and attach it to the same LAN as the gateway.

## 2. Set the two required variables

On the gateway, read the shared secret:

    cat /srv/lc3/state/worker_token

Then, in balenaCloud, open the fleet, go to **Variables**, and add:

| Variable | Value |
| --- | --- |
| `LC3_GATEWAY` | the gateway's LAN IP, e.g. `192.168.1.146` |
| `LC3_WORKER_TOKEN` | the token printed above |

Or from the CLI:

    balena env set LC3_GATEWAY 192.168.1.146 --fleet lc3-workers
    balena env set LC3_WORKER_TOKEN "<token>" --fleet lc3-workers

`balena/set-vars.sh` does both in one step. A wrong token is rejected by the
gateway with `403 bad worker token`, visible in the runner's device logs.

## 3. What happens next

The `cdn` service mirrors `/heavy/` from the gateway (Pyodide is a few hundred
MB, so the first pass takes a while on a Pi 3) and only then answers `/health`.
The `runner` service holds its heartbeat until that check passes, because the
gateway fails an asset upstream over on a 5xx but not on a 404 — a
half-mirrored worker in the pool would hand students missing files. Once the
mirror finishes, the worker appears as `up` in the teacher's admin view and
starts taking grading, runs, and asset traffic.

## Variables

Every value below is a default baked into the image, so setting a fleet,
device, or service variable of the same name in the dashboard overrides it and
restarts the service. Nothing here needs a rebuild.

### Required (service: `runner`, and `LC3_GATEWAY` also for `cdn`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `LC3_GATEWAY` | *(empty)* | Gateway IP or hostname. Set it fleet-wide so both services get it. |
| `LC3_WORKER_TOKEN` | *(empty)* | Shared secret from `/srv/lc3/state/worker_token` on the gateway. |

### Identity and reporting (`runner`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `LC3_WORKER_ID` | balena device UUID | The id the gateway tracks this worker by. Leave empty on a fleet variable; set it per device only to force a name. |
| `LC3_HEARTBEAT_SEC` | `30` | Seconds between check-ins. The gateway marks a worker down after it stops hearing from it. |
| `LC3_CDN_GATE` | `1` | Hold the heartbeat until this device's asset mirror is complete. Set `0` to join the pool immediately (students may hit 404s). |
| `LC3_RUNNER_CDN_PORT` | `80` | The asset port reported to the gateway. Must match `LC3_CDN_PORT`. |

### Capacity (`runner`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `LC3_MAX_RUNS` | scaled to RAM | Concurrent interactive runs. The default is `(MemTotal_MB - 350) / 130`, clamped to 4..20: about 5 on a 1GB Pi 3. |
| `LC3_GRADE_CONCURRENCY` | `2` | Submissions graded at once. Grading is CPU-heavy; raising this on a Pi 3 slows every job. |
| `LC3_RUNNER_PORT` | `9500` | Port the gateway dispatches jobs to. |
| `LC3_RUNNER_BIND` | `0.0.0.0` | Bind address. |

### Per-job limits (`runner`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `LC3_MAX_TIMEOUT` | `90` | Ceiling on a submission's grading timeout, in seconds. |
| `LC3_MEM_MIN_MB` / `LC3_MEM_MAX_MB` | `64` / `512` | Clamp on the memory an assignment may request. |
| `LC3_GRADE_JAVA_XMX_MB` | `200` | JVM heap while grading Java. |
| `LC3_RUN_JAVA_XMX_MB` | `64` | JVM heap for a student pressing Run. Multiplied by `LC3_MAX_RUNS`, so keep it small. |
| `LC3_RUN_MEM_MB` | `256` | Memory cap for one interactive run. |
| `LC3_RUN_TIMEOUT` | `600` | Hard kill for an interactive run, in seconds. |
| `LC3_COMPILE_MEM_MB` / `LC3_COMPILE_TIMEOUT` | `384` / `60` | `javac` limits. |
| `LC3_TASKS_MAX` | `64` | Process cap per job (fork-bomb guard). |
| `LC3_CPU_QUOTA` | `200%` | CPU cap per job. Applies only where systemd is present, so not on balena. |
| `LC3_ULIMIT_AS` | `1` | Apply an address-space cap to Python jobs when systemd is absent. |
| `LC3_ULIMIT_AS_MULT` | `2.0` | Address space allowed, as a multiple of the job's memory cap. Lower it to tighten, raise it if legitimate student code dies with `MemoryError`. |
| `LC3_ULIMIT_FSIZE_KB` | `131072` | Largest file a job may write (128MB). |

Java is deliberately left out of the address-space cap: a JVM reserves a large
virtual range at startup and cannot run under one. Java is bounded by `-Xmx`
and by the container's `mem_limit`.

### Asset mirror (`cdn`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `LC3_CDN_PORT` | `80` | Port the mirror listens on. |
| `LC3_MIRROR_ENABLE` | `1` | Set `0` to serve only what is already on disk and skip the download. |
| `LC3_MIRROR_JOBS` | `4` | Parallel downloads during the first mirror. |
| `LC3_MIRROR_RETRY_SEC` | `30` | Wait before retrying a failed pass (gateway not up yet, for instance). |
| `LC3_MIRROR_REFRESH_SEC` | `900` | Re-check the manifest this often, so new gateway assets propagate. `0` disables it. |
| `LC3_MIRROR_PRUNE` | `0` | Delete local files no longer in the gateway manifest. |
| `LC3_MIRROR_FILE_TIMEOUT` | `300` | Per-file download timeout. |
| `LC3_CDN_MAX_AGE` | `2592000` | `Cache-Control: max-age` on served assets. |

### Build-time, not a dashboard variable

`BASE_IMAGE` selects the balenalib base (`aarch64` by default, `armv7hf` for a
32-bit fleet). Pass it with `--buildArg`, and the container memory caps
(`mem_limit`, `pids_limit`, `tmpfs` size) are in `docker-compose.yml`, since
Docker resource limits are fixed at deploy time and cannot come from a variable.

## Optional: SOCKS5 egress via the VPN box (`egress-proxy`)

`egress-proxy` is a third service, idle by default. When enabled it runs
xray-core as a trojan+TLS client, dialing out to a VPN box and exposing a
plain SOCKS5 proxy on the device's own loopback (`127.0.0.1:1080` by
default). Once that's listening, it PATCHes balenaOS's own host proxy to
point at itself via the local Supervisor API (`BALENA_SUPERVISOR_ADDRESS` /
`BALENA_SUPERVISOR_API_KEY`, injected by the `io.balena.features.supervisor-api`
label on this service) — so the supervisor's own connection to balenaCloud
routes through the tunnel too, not just other containers' traffic. This is
done locally, on the device, deliberately: configuring it from the
balenaCloud dashboard/CLI would need a working balenaCloud connection in the
first place, which is exactly what a flaky network makes unavailable.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LC3_EGRESS_ENABLE` | `0` | Set `1` to run the tunnel; otherwise the service idles doing nothing. |
| `LC3_EGRESS_SERVER` | `54.210.85.169` | The trojan server's **IP**, not its hostname. A balena device only has whatever DNS the classroom LAN hands it, so resolving `vpn.cheesle.com` there is one more silent failure mode; connecting by IP avoids it. |
| `LC3_EGRESS_SNI` | `vpn.cheesle.com` | The cert's hostname. TLS validates against this even though the connection dials the IP above — never point it at an IP or the handshake fails. |
| `LC3_EGRESS_PASSWORD` | *(empty, required)* | The trojan client password from the server's `inbounds[0].settings.clients[].password`. **Must be a client dedicated to this fleet** (its own password/email), never one shared with a personal device — if the VPN box's routing restricts LAN access by client identity (`user` in a routing rule matched against the client email), a shared password bypasses that restriction entirely for whichever client uses it. Set as a fleet/device variable, never baked into the image. |
| `LC3_EGRESS_SERVER_PORT` | `443` | Trojan server port. |
| `LC3_EGRESS_ALPN` | `http/1.1` | Must match the server's `tlsSettings.alpn`. |
| `LC3_EGRESS_SOCKS_PORT` | `1080` | Local SOCKS5 port on the device's loopback. |
| `LC3_EGRESS_SET_HOST_PROXY` | `1` | Set `0` to skip the self-PATCH and leave the host proxy alone (e.g. to configure it manually, or during testing). |

Enable it:

    balena env set LC3_EGRESS_ENABLE 1 --fleet lc3-workers
    balena env set LC3_EGRESS_PASSWORD "<trojan client password>" --fleet lc3-workers

Only override `LC3_EGRESS_SERVER` / `LC3_EGRESS_SNI` if the VPN box's IP or
hostname changes from the defaults baked into the image.

`balena logs <uuid> --service egress-proxy` shows the tunnel target, whether
xray started cleanly, and whether the host-proxy PATCH succeeded.

## Operating notes

- **Egress lockdown is not reproduced here, and should not be.** The Arch
  worker installed an `iptables -A OUTPUT -j DROP` fallback. On balenaOS the
  container shares the host network namespace, so that rule would also cut the
  device off from balenaCloud. It is redundant in any case: `bwrap
  --unshare-all` gives graded code an empty network namespace, so it has no
  route out regardless of host firewall rules.
- **`privileged: true` on the runner is required.** Without it `bwrap` cannot
  create namespaces, and the runner refuses to start rather than grade
  unsandboxed. The log line is `bwrap cannot unshare namespaces`.
- **Logs.** `balena logs <uuid> --service runner` shows the effective limits at
  startup, heartbeat failures, and the mirror's progress.
- **Removing a device** from the fleet leaves its last row in the gateway's
  worker list; it goes to `down` when the heartbeats stop, and the teacher's
  admin view can delete it.
- **Whoever hosts the VPN box for `egress-proxy` must isolate this fleet's
  traffic from anything else that box can reach.** Give the fleet its own
  trojan client (its own password/email) and, if the box shares a network
  with other things worth protecting (e.g. it's a home server, not an
  isolated cloud box), add a routing rule blocking that client's access to
  private IP ranges — an xray/v2ray rule like `{"type":"field","user":
  ["<fleet client email>"],"ip":["geoip:private"],"outboundTag":"<blackhole
  tag>"}` does this without affecting any other client on the same box.
  Never apply that block server-wide if the box also serves personal
  traffic that needs real LAN access.
