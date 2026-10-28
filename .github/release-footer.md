### Installing

Download **{installer}** from the assets below and open it. It installs {name} for your Windows account without asking for administrator rights, adds a Start menu entry and a desktop shortcut, and starts the app. {name} needs Windows 10 or 11, 64-bit.

{name} is not code-signed, so your browser and Windows may warn you the first time:

1. Edge may say that the file isn't commonly downloaded. In its Downloads panel, point at the download, click **...** and choose **Keep**; in the box that opens, click the arrow beside **Delete** and choose **Keep anyway**. Other browsers ask in their own words; choose to keep the file.
2. When you open it, Windows may say "Windows protected your PC". Click **More info**, then **Run anyway**.

### Updates

You download {name} only once. After that, updates arrive in the app: it checks for new versions and offers to download and install each one, so you need not come back here.

### Checksums

`SHA256SUMS.txt` holds the SHA-256 checksum of the installer and of the two files the updater reads, `latest.yml` and the installer's `.blockmap`. To check the installer, run this in PowerShell, changing the folder if you saved it somewhere other than Downloads:

```powershell
Get-FileHash "$HOME\Downloads\{installer}"
```

The hash it prints should match the one on the line for {installer} in `SHA256SUMS.txt`. PowerShell prints the letters in capitals, which makes no difference.

### Claude Code

Reviews with Claude need Claude Code, which you install and sign in to yourself; it is not included. The app's Setup screen shows how, one step at a time, and the [README](https://github.com/{repo}#readme) covers the rest.
