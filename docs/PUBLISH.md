# Publish g-zero to GitHub

Target repository: `michaelcrosato/g-zero`.

This source package is ready to upload. The package alone does not create or update a remote repository.

## Upload through the website

Create a repository named `g-zero` under `michaelcrosato`, or open that repository if it already exists. Select the visibility you require.

Extract the source ZIP. Use **Upload files** on GitHub and add the **contents** of the `g-zero` folder. Do not upload only the ZIP file. Keep `index.html`, `src/`, `boot/`, `vendor/`, and the other files at the repository root. Include the hidden `.github` folder to enable the verification workflow. Commit the upload.

For an existing nonempty repository, review its files first. Merge this package into a branch instead of replacing unrelated files.

## Publish with GitHub CLI

These commands are for a **new repository** and an extracted source folder with no Git history. Git and GitHub CLI must already be installed. Authenticate in your terminal; do not paste an access token into the game or a chat.

```sh
cd g-zero
gh auth login
git init -b main
git add .
git commit -m "Add g-zero source and complete offline game"
gh repo create michaelcrosato/g-zero --public --source=. --remote=origin --push
```

The example creates the intended public repository. The command fails if the repository already exists. It does not overwrite another repository.

For an existing repository, clone it first, create a working branch, and copy the source package into that working tree. Keep the existing `.git` directory. Commit and push the branch, then open a pull request. Do not use a force push.

## After upload

Check that GitHub shows the source folders and `index.html`. The **Verify source and deployment builds** workflow checks the deterministic offline file, all 88 unit tests, and production build output on each push and pull request. Review its actual result in the Actions tab.

Follow [Vercel deployment](VERCEL.md) to import the repository and publish the optimized hosted build. GitHub source hosting alone does not start a website. Offline players still need only the complete HTML file.

## Official references

- [Add files to a repository](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
- [GitHub CLI: create a repository](https://cli.github.com/manual/gh_repo_create)
