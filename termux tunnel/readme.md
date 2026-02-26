# Mobile Reverse SSH SOCKS Proxy (Termux → VPS) — Production Setup Guide

This guide explains how to create a **permanent SOCKS proxy on a VPS using a mobile phone’s IP**, using Termux and reverse SSH tunneling.

This setup is:

* Persistent
* Auto-reconnect
* Survives reboot
* Survives airplane mode toggle
* Requires no manual intervention
* Production safe

---

# Architecture Overview

```
Phone (Termux)
   ↓ Reverse SSH Tunnel
VPS (SSH server + systemd service)
   ↓ SOCKS5 Proxy
Node / curl / apps use proxy
```

---

# Requirements

## Phone Requirements

Install these apps from F-Droid:

* Termux
* Termux:Boot
* Termux:API

DO NOT install Termux from Play Store.

---

## VPS Requirements

* Ubuntu / Debian VPS
* Root access
* Open port 22

---

# PART 1 — PHONE SETUP (TERMUX)

Open Termux.

---

## Step 1 — Update Termux

```
pkg update -y
pkg upgrade -y
```

---

## Step 2 — Install required packages

```
pkg install openssh autossh termux-api -y
```

---

## Step 3 — Find phone username

```
whoami
```

Example output:

```
u0_a858
```

Save this value. This is your PHONE_USERNAME.

---

## Step 4 — Generate SSH key on PHONE

```
ssh-keygen -t ed25519
```

Press Enter for all prompts.

This creates:

```
~/.ssh/id_ed25519
~/.ssh/id_ed25519.pub
```

---

## Step 5 — Copy phone public key

```
cat ~/.ssh/id_ed25519.pub
```

Copy the output.

---

# PART 2 — VPS SETUP

Login to VPS:

```
ssh root@YOUR_VPS_IP
```

---

## Step 6 — Add phone key to VPS

```
nano ~/.ssh/authorized_keys
```

Paste phone public key.

Save.

Set permissions:

```
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

---

## Step 7 — Test SSH from PHONE → VPS

On phone:

```
ssh root@YOUR_VPS_IP
```

It should login WITHOUT password.

Exit:

```
exit
```

---

# PART 3 — CREATE TUNNEL SCRIPT ON PHONE

On phone:

```
nano ~/tunnel.sh
```

Paste your final working script.

Save.

Make executable:

```
chmod +x ~/tunnel.sh
```

Test manually:

```
bash ~/tunnel.sh
```

---

# PART 4 — CREATE VPS → PHONE SSH KEY

On VPS:

```
ssh-keygen -t ed25519 -f ~/.ssh/phone_proxy_key
```

Press Enter.

Copy public key:

```
cat ~/.ssh/phone_proxy_key.pub
```

---

## Step 8 — Add VPS key to PHONE

On PHONE:

```
nano ~/.ssh/authorized_keys
```

Paste VPS key.

Save.

Fix permissions:

```
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

Restart sshd:

```
pkill sshd
sshd
```

---

# PART 5 — CREATE VPS PROXY SERVICE

On VPS:

```
nano /etc/systemd/system/syrian-proxy.service
```

Paste your final working service file.

Save.

Reload systemd:

```
systemctl daemon-reload
```

Enable auto-start:

```
systemctl enable syrian-proxy
```

Start service:

```
systemctl restart syrian-proxy
```

Check status:

```
systemctl status syrian-proxy
```

Should show:

```
active (running)
```

---

# PART 6 — TEST PROXY

On VPS:

```
curl --proxy socks5h://127.0.0.1:1081 ifconfig.me
```

It should show phone IP.

---

# PART 7 — AUTO START TUNNEL ON PHONE BOOT

Create boot script:

```
mkdir -p ~/.termux/boot
nano ~/.termux/boot/start.sh
```

Paste:

```
#!/data/data/com.termux/files/usr/bin/bash

bash ~/tunnel.sh
```

Save.

Make executable:

```
chmod +x ~/.termux/boot/start.sh
```

---

# PART 8 — IMPORTANT ANDROID SETTINGS

Go to:

Settings → Apps → Termux → Battery

Set:

```
Unrestricted
```

Disable:

```
Battery optimization
```

Add Termux to:

```
Never sleeping apps
```

---

# PART 9 — VERIFY EVERYTHING

On VPS:

```
systemctl status syrian-proxy
```

and

```
ss -tlnp | grep 1081
```

and

```
curl --proxy socks5h://127.0.0.1:1081 ifconfig.me
```

---

# PART 10 — TEST AUTO RECOVERY

Test these scenarios:

* Turn airplane mode ON → OFF
* Reboot phone
* Reboot VPS
* Switch WiFi / mobile data

Proxy should recover automatically.

---

# Useful Commands

Restart proxy service:

```
systemctl restart syrian-proxy
```

Restart tunnel manually:

```
bash ~/tunnel.sh
```

Check tunnel port:

```
ss -tlnp | grep 2222
```

---

# Final Result

You now have a production-grade mobile SOCKS proxy.

Features:

* Persistent tunnel
* Automatic reconnect
* Automatic restart
* Fully autonomous

---

# Proxy Address

```
socks5h://127.0.0.1:1081
```

---

# Done
