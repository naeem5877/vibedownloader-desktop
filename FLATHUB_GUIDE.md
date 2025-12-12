# How to Submit VibeDownloader to Flathub

Getting your app on Flathub allows Linux users to install it easily regardless of their distribution.

## Prerequisites
1.  **Release on GitHub**: Ensure you have successfully run your Release workflow and have `.deb` files in your GitHub Releases.
    *   Example: `VibeDownloader-1.0.3-linux-amd64.deb`

## Step 1: Prepare the Manifest
1.  Open the file `flatpak/me.vibedownloader.VibeDownloader.yml`.
2.  Locate the `sources` section at the bottom.
3.  Comment out `path: vibe-downloader.deb` and uncomment `url` and `sha256`.
4.  Update the `url` to point to your **latest released .deb file** on GitHub.
5.  Calculate the SHA256 of that .deb file and put it in the `sha256` field.
    *   Linux/Mac: `sha256sum VibeDownloader-1.0.3-linux-amd64.deb`
    *   Windows (PowerShell): `Get-FileHash VibeDownloader-1.0.3-linux-amd64.deb -Algorithm SHA256`

## Step 2: Test Locally (Optional but Recommended)
If you have Linux with `flatpak-builder` installed:
```bash
flatpak-builder --user --install --force-clean build-dir flatpak/me.vibedownloader.VibeDownloader.yml
```

## Step 3: Submit to Flathub
1.  Go to [https://github.com/flathub/flathub](https://github.com/flathub/flathub).
2.  **Fork** the repository.
3.  In your fork, create a **new branch** named `me.vibedownloader.VibeDownloader` (or similar).
4.  Add your manifest file (`me.vibedownloader.VibeDownloader.yml`) to the root of your branch.
5.  You may need to add flathub-shared-commit hooks or just upload the file.
6.  Create a **Pull Request** to the main `flathub/flathub` repository.

## Step 4: Review
-   The Flathub bot will run automatic tests.
-   A reviewer will check your manifest. They might ask you to build from source instead of using the `.deb` file.
    -   *Note: Building Electron from source in Flatpak is complex. If they ask for this, you can explain that you are the upstream developer providing the official binary, but be prepared that they prefer source builds for Open Source apps.*

## Step 5: Maintenance
-   Once accepted, a specialized repository `https://github.com/flathub/me.vibedownloader.VibeDownloader` will be created.
-   To update the app in the future, you will just submit PRs to *that* repository with the new version URL and SHA256.
