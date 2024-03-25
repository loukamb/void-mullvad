import { exec } from "node:child_process"
import { promises as fs, existsSync as exists, existsSync } from "node:fs"
import path from "node:path"
import os from "node:os"

async function execAsync(cmd, cwd) {
  return new Promise((resolve, fail) =>
    exec(cmd, { cwd }, (error, stdout, stderr) => {
      if (error) {
        fail(error)
      }
      resolve(stdout ?? stderr)
    })
  )
}

if (process.getuid() !== 0) {
  console.error("You must run void-mullvad as root!")
  process.exit(1)
}

if (process.argv.includes("--install")) {
  let tmpDir
  if (!existsSync("/opt/Mullvad VPN")) {
    // Create temporary directory.
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "void-mullvad-"))
    const tmpArchive = path.join(tmpDir, "mullvad.deb")

    // Download latest archive.
    console.log("(1/7) Downloading latest Mullvad VPN")
    const archiveStream = await (
      await fetch("https://mullvad.net/en/download/app/deb/latest")
    ).arrayBuffer()

    // Write and unpack files.
    console.log("(2/7) Extracting package")
    await fs.writeFile(tmpArchive, Buffer.from(archiveStream))
    await execAsync(`ar x mullvad.deb`, tmpDir)
    await execAsync(`tar -xf data.tar.xz`, tmpDir)

    // Install content from /usr and /opt.
    console.log("(3/7) Installing package")
    await fs.cp(path.join(tmpDir, "usr"), "/usr", {
      recursive: true,
      force: true,
    })
    await fs.cp(path.join(tmpDir, "opt"), "/opt", {
      recursive: true,
      force: true,
    })
  } else {
    console.log("Mullvad VPN already installed..")
    process.exit(1)
  }

  // Create mullvad runit service.
  console.log("(4/7) Installing runit service")
  if (!exists("/etc/sv/mullvad")) {
    await fs.mkdir("/etc/sv/mullvad")
  }
  await fs.copyFile(
    path.join(import.meta.dirname, "run"),
    "/etc/sv/mullvad/run"
  )
  await execAsync("chmod +x /etc/sv/mullvad/run")

  // Start mullvad service.
  console.log("(5/7) Launching runit service")
  await execAsync("sudo ln -s /etc/sv/mullvad /var/service")

  // Refresh desktop entries.
  console.log("(6/7) Refresh XDG desktop entries")
  await execAsync("xdg-desktop-menu forceupdate")

  // Cleanup temporary files.
  console.log("(7/7) Cleaning up.")
  if (tmpDir !== undefined) {
    await fs.rm(tmpDir, { recursive: true })
  }

  console.log("Mullvad VPN is now up and running!")
  process.exit(0)
} else if (process.argv.includes("--uninstall")) {
  // Stop service.
  console.log("(1/4) Stopping Mullvad service.")
  try {
    await execAsync(`sudo sv down mullvad`)
    await fs.rm("/var/service/mullvad")
  } catch {
    console.warn("Failed to stop Mullvad service.")
  }

  // Uninstall Mullvad binaries from /usr.
  console.log("(2/4) Uninstalling Mullvad service.")
  try {
    await fs.rm("/etc/sv/mullvad", { recursive: true })
    await fs.rm("/usr/bin/mullvad")
    await fs.rm("/usr/bin/mullvad-daemon")
    await fs.rm("/usr/bin/mullvad-exclude")
    await fs.rm("/usr/bin/mullvad-problem-report")
  } catch {}

  // Uninstall Mullvad GUI from /opt.
  console.log("(3/4) Uninstalling Mullvad GUI.")
  try {
    await fs.rm("/opt/Mullvad VPN", { recursive: true })
  } catch {}

  // Uninstall Mullvad metadata.
  console.log("(4/4) Removing Mullvad metadata.")
  try {
    await fs.rm("/usr/local/share/zsh/site-functions/_mullvad")
    await fs.rm("/usr/share/applications/mullvad-vpn.desktop")
    await fs.rm("/usr/share/doc/mullvad-vpn")
    await fs.rm("/usr/share/fish/vendor_completions.d/mullvad.fish")
  } catch {}

  console.log("Mullvad has been uninstalled.")
}
