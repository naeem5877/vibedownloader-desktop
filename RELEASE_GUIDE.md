# 🚀 How to Publish a Release (Tutorial)

Since this project is set up with **GitHub Actions**, releasing a new version is automated. You don't need to manually build or upload `.exe` files. GitHub does it for you.

## Prerequisite: GitHub Settings
1. Go to your Repo on GitHub.
2. Click **Settings** > **Actions** > **General**.
3. Scroll to **Workflow permissions**.
4. Select **"Read and write permissions"**.
5. Click **Save**.

---

## Step-by-Step Release Guide

### 1. Update Version Number
Before releasing, open `package.json` and increase the version number.
```json
"version": "1.0.0"  --> change to "1.0.1"
```
*Note: If this is your very first release, "1.0.0" is fine.*

### 2. Commit your changes
Open your terminal (PowerShell) and save everything:
```powershell
git add .
git commit -m "Preparing release v1.0.0"
```

### 3. Tag the Release
This is the magic step. Telling Git "This specific point in time is version 1.0.0".
```powershell
git tag v1.0.0
```

### 4. Push to GitHub
Send the code and the tag to GitHub.
```powershell
git push origin main
git push origin v1.0.0
```

### 5. Watch the Magic 🪄
1. Go to your GitHub Repo -> **Actions** tab.
2. You will see a workflow running named **Release**.
3. Wait about 5-10 minutes.
4. Go to the **Releases** section (sidebar).
5. You will see "v1.0.0" with all the files (exe, dmg, AppImage) attached automatically!

---

## ❓ Common Questions

**Q: What is `GH_TOKEN` / `secrets.GITHUB_TOKEN`?**
A: It is a temporary password GitHub creates automatically for the "Action" robot. You do NOT need to create it manually. The robot uses it to verify "I am authorized to upload these files to Naeem's repo."

**Q: My Mac build failed?**
A: Apple requires you to pay (\$99/year) to "Notarize" apps. Without this, the build might show warnings or users might see "Unidentified Developer". For a free open source project, you can ignore this initially, or look into "Apple Developer ID" later. The Windows/Linux builds will work fine for free.

**Q: How do updates work?**
A: When you release `v1.0.1` following these steps, users who have `v1.0.0` installed will get a notification (thanks to the code we added) and can update automatically.
