<a title="Tailscale on Twitter" href="https://twitter.com/tailscale"><img alt="Twitter Follow" src="https://img.shields.io/twitter/follow/tailscale?style=social"></a>
<a title="Tailscale on the Fediverse" href="https://hachyderm.io/@tailscale"><img alt="Mastodon Follow" src="https://img.shields.io/mastodon/follow/109343780291948032?domain=https%3A%2F%2Fhachyderm.io&style=social"></a>
<a title="Tailscale on YouTube" href="https://youtube.com/tailscale"><img alt="YouTube Channel Views" src="https://img.shields.io/youtube/channel/views/UCcdv38QxPjSMqbt5ffLhJLA?style=social"></a>
<a title="Tailscale on GitHub" href="https://github.com/tailscale"><img alt="Tailscale's stars" src="https://img.shields.io/github/stars/tailscale?style=social"></a>

<p align="center">
  <br />
  <a title="Learn more about Tailscale" href="https://tailscale.com"><img width="476px" src="https://github.com/tailscale-dev/tailscale-dev/assets/40265/113339dc-fea6-4ccf-a284-22ecee62c7c9" alt="Tailscale Logo" /></a>
</p>

> Notice for Linux users: We're working to resolve an issue preventing this extension from being used on Linux. However, you can still use Funnel from the CLI ([docs](https://tailscale.com/kb/1223/tailscale-funnel/?q=funnel)).

> Tailscale is a free and open source service, based on WireGuard®, that helps users build no-hassle virtual private networks. With a Tailscale network (tailnet), you can securely access services and devices on that tailnet from anywhere in the world. Tailnets can include anything from a Digital Ocean droplet to a Raspberry Pi, home security camera, or even a Steam Deck. You can share nodes with friends or co-workers, or even expose ports to the public internet with Tailscale Funnel.

# Tailscale for Visual Studio Code

The Tailscale extension for VS Code brings no-hassle, secure networking alongside your code. With Tailscale Funnel you can share anything from a device or node in your Tailscale network (tailnet) with anyone on the Internet.

## Features

### Expose a port over the internet

Route traffic from the internet to a node in your tailnet to publicly share it with anyone, even if they aren’t using Taiscale.

> _When you want something local to be available everywhere_

For example, you might want to receive a webhook from GitHub, share a local service with your coworker, or even host a personal blog or status page on your own computer.

#### Tailscale Funnel panel

![A demo showing the VS Code extension's panel view used to serve local port 3000 (a Next.js boilerplate app) to a public URL with Tailscale Funnel](https://github.com/tailscale-dev/tailscale-dev/assets/40265/e9d1eac5-cf11-4075-bf8d-e8a377e2c9ed)

1. Open the panel. You can use the keyboard shortcut `CMD` + `J`.
2. Enter the local port you want to expose over the internet in the **port** field.
3. Click **Start** to begin serving this port over the internet.

You can open the public URL in your default browser or copy it to your clipboard.

#### With the Command Palette

![A demo showing the VS Code extension's palette view used to serve local port 3000 (a Next.js boilerplate app) to a public URL with Tailscale Funnel](https://github.com/tailscale-dev/tailscale-dev/assets/40265/97a177a3-3632-4dea-8a95-0ec3c631995d)

1. Open the command palette with the keyboard shortcut CMD + Shift + P.
2. Type **Tailscale** to view all of the extension’s commands.
3. Choose **Tailscale: Share port publicly using Funnel**.
4. Enter the local port number that you wish to share via Funnel.

#### Port discovery

![A demo showing the VS Code extension's port discovery feature used to serve local port 3000 (an Astro boilerplate app) to a public URL with Tailscale Funnel](https://github.com/tailscale-dev/tailscale-dev/assets/40265/63b0a26b-018b-4158-a20d-22789bbca707)

When you start a local server from VS Code, Tailscale will ask if you'd like to share that port over the internet with Funnel.

## How Funnel works

| Internet accessible                                                                                         | Secure tunnel                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Stable and public DNS records point to Tailscale ingress servers, so your hostnames are always predictable. | Tailscale ingress servers forward TLS-encrypted traffic to your private nodes using our secure, lightweight tunnels. |

| End-to-end encrypted                                                                                         | Proxy or serve requests                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Auto-provisioned TLS certificates terminate on your private nodes, so we never see your unencrypted traffic. | Serve local files, directories, or static content — or reverse proxy requests to a local web or TCP server. |

For more information, visit the full documentation on [Tailscale Funnel](https://tailscale.com/kb/1223/tailscale-funnel/) or the [CLI](https://tailscale.com/kb/1242/tailscale-serve/) reference.

## Setup

1. [Install Tailscale](https://tailscale.com/download) and login or create a new account.
2. [Install this extension](vscode:extension/Tailscale.vscode-tailscale) in VS Code.

> ⚠️ Important: You'll need to make sure that HTTPS certificates and Funnel are enabled in the Tailscale admin console. Refer to our [documentation](https://tailscale.com/kb/1223/tailscale-funnel/#setup) for more instructions.

## Commands

- _Tailscale: Share port publicly using Funnel_ - expose a single port publicly over Funnel.
- _Tailscale: Focus on Funnel View_ - open the Funnel panel view.

## Troubleshooting

If the extension isn't working, we recommend following these steps to troubleshoot.

1. Check to ensure that Tailscale is signed in and active. On macOS and Windows, you can do this by clicking the Tailscale icon in your OS status bar. On Linux, run `tailscale status` in your CLI.
   - If you have signed in to multiple Tailscale accounts on your device, ensure that the correct account is active.
2. Ensure that your Tailnet access controls (ACLs) are [configured to allow Tailscale Funnel](https://tailscale.com/kb/1223/tailscale-funnel/#setup) on your device.
3. Ensure that [magicDNS and HTTPS Certificates are enabled](https://tailscale.com/kb/1153/enabling-https/) on your tailnet.
4. Ensure `tailscale` is available in the environment path. You can check this by running `tailscale status` in your CLI; if no command is found, you may need to add the Tailscale executable to your path. Alternatively, you can set its path via the `tailscale.path` setting in VS Code.

## Configuration

- `tailscale.path`: A path to the `tailscale` executable. If unset, the extension will use
  the environment path to resolve the `tailscale` executable. If set, the extension
  will use the supplied path. The path should include the executable name (e.g.
  `/usr/bin/tailscale`, `C:\Program Files\tailscale\tailscale.exe`).

## Contribute

We appreciate your help! For information on contributing to this extension, refer to the [CONTRIBUTING](CONTRIBUTING.md) document.

## Legal

WireGuard is a registered trademark of Jason A. Donenfeld.
