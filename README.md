# Ganesha Idol Voting 2026

Public voting page for the Ganesha Idol Competition 2026.

## Image folder

Google Drive folder ID:

`1VSzL0_kOhF3v_GuAJV4ReRvQbB0ea3x-`

Keep exactly four finalist images in the folder and name them in voting order:

- `entry-01.png`
- `entry-02.png`
- `entry-03.png`
- `entry-04.png`

The extension is not important. PNG, JPG/JPEG, WebP and other image files recognised by Google Drive can be used. The website uses Google Drive thumbnails, so changing the image format does not require a website code change.

## One-time Google Apps Script deployment

The website needs a tiny public JSON feed so it can discover the images currently inside the Drive folder.

1. Open https://script.google.com and create a new project.
2. Replace the default code with `apps-script/Code.gs` from this repository.
3. Click **Deploy > New deployment**.
4. Choose **Web app**.
5. Set **Execute as** to **Me**.
6. Set **Who has access** to **Anyone**.
7. Deploy and copy the `/exec` URL.
8. Save that URL in Supabase `public.vote_settings.image_feed_url`.

After that, images can be replaced in the Drive folder without changing GitHub. The four images are read in filename order.

## Voting backend

Supabase project: `ganesha-idol-voting-2026`

The current setup provides:

- four neutral voting slots: Entry 01 to Entry 04
- one saved choice per browser token
- ability to change a vote while voting is open
- results hidden by default
- voting open/closed control in `vote_settings`
- optional live results through `show_results`

## GitHub Pages

Publish the repository from the `main` branch, root folder, in **Settings > Pages**.
