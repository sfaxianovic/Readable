# Publishing the Extension Privately

This guide walks through preparing your build, submitting it to the Chrome Web Store (CWS), and keeping the listing private so only invited users can install it.

## 1. Collect Required Assets

- Final extension ZIP built from the production folder (no source control files).
- Screenshot(s) or promo images for the Store listing (PNG/JPG ≥ 1280×800).
- Short & long descriptions (plain text, ≤ 132 chars and ≤ 16 k chars respectively).
- Category choice, language, and support/privacy URLs (these can point to docs or a simple landing page).

## 2. Prepare a Production ZIP

1. From the project root, run a clean build if needed.
2. Copy only the runtime files (manifest, scripts, icons, assets) into a fresh folder named `achromatopsia-extension-prod`.
3. Create a ZIP archive *of the folder contents* (not the folder itself) named `achromatopsia-extension.zip`.

## 3. Access the Developer Dashboard

1. Visit <https://chrome.google.com/webstore/devconsole> and sign in with the Google account that owns the publisher profile.
2. If this is your first submission, pay the one-time developer registration fee and complete the publisher profile (name, email, website).

## 4. Create a Draft Item

1. Click **Items** → **New Item**.
2. Upload the ZIP created in step 2. The dashboard unpacks and validates it.
3. Fix validation errors, re-zip, and re-upload if the manifest fails to parse.

## 5. Complete the Store Listing

1. Fill in *Store listing* sections: title, short description, full description, category, language, and contact details.
2. Upload at least one screenshot. For a private listing the promo tile is optional, but adding a 1280×800 screenshot helps testers recognize the extension.
3. Provide the privacy policy URL (required for any use of `storage`, `scripting`, or user data).

## 6. Configure Privacy & Visibility

1. Open the **Distribution** tab.
2. Under *Visibility*, choose **Private**.
3. Enter the email addresses or Google Workspace domains allowed to install the extension. Only these accounts will see the listing.
4. Set countries if you need to limit availability further (optional).

## 7. Review Permissions & Compliance

1. On the **Privacy practices** and **Data disclosure** sections, declare every permission (e.g., `activeTab`, `scripting`, `storage`).
2. Confirm you comply with Chrome Web Store policies, especially around limited audience distribution.

## 8. Submit for Review

1. From the item overview page, click **Submit for review**.
2. Monitor the status (Pending review → Approved/Rejected). Reviews usually take a few days for private listings.

## 9. Share the Private Listing

1. Once approved, copy the private store URL from the dashboard.
2. Share it with the allowed users. They must be signed into Chrome with one of the authorized accounts to see the install button.

## 10. Update or Revoke Access

- To ship updates, bump the `version` in `manifest.json`, rebuild the ZIP, upload a new package, and submit again.
- To change who can install, edit the email/domain allowlist in **Distribution** and resubmit (no package update required).
- To pause distribution entirely, set visibility to **Unlisted** or remove all authorized accounts.

---

Following these steps publishes the extension privately on the Chrome Web Store, letting you control exactly who can install it while still using Chrome’s automatic update pipeline.
