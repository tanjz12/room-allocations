const UPDATED = 'October 16, 2026';

export default function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <div className="page privacy">
      <button className="linklike" onClick={onBack}>‹ Back</button>
      <h2>Privacy</h2>
      <p className="muted">Last updated {UPDATED}. This room allocation site is run by Berkeley Math Tournament (BMT) for planning tournament rooms.</p>
      <ul>
        <li><b>No accounts:</b> there's no login and no server of its own. The site runs in your browser.</li>
        <li><b>Your data:</b> data packages stay in your browser's local storage, or in the Google Drive files and folders you choose. BMT doesn't receive or store them. Clearing site data, or More ▾ → Clear all data, removes them from the browser.</li>
        <li><b>Tracking:</b> no analytics, ads, cookies or other tracking. The site's host keeps standard request logs.</li>
      </ul>
      <h3>Google sign-in</h3>
      <ul>
        <li><b>Optional:</b> you only need it to open or save files on Google Drive.</li>
        <li><b>What the site can access:</b> only Google's <code>drive.file</code> permission, which covers the files and folders you pick in Google's file picker and the files the site creates for you. It can't see the rest of your Drive. It also reads your account's email address to show who is signed in.</li>
        <li><b>How it's used:</b> to read the data package you open, and to save that package, its Google Sheet, and the maps and room signs you generate to the folders you pick. Nothing else.</li>
        <li><b>Storage and sharing:</b> files go straight between your browser and Google over HTTPS. The sign-in token is kept only for this browser session and is never sent anywhere except Google. Google data is not sold, shared with anyone, or used for ads.</li>
        <li><b>Removing access:</b> use More ▾ → Sign out of Google, or remove the site at <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">myaccount.google.com/connections</a>.</li>
        <li>The site's use of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. Google's <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">privacy policy</a> applies to Google sign-in and the file picker.</li>
      </ul>
      <h3>Changes</h3>
      <p>If this notice changes, the date above changes with it. If the site ever needs more Google data than described here, it will ask you first.</p>
    </div>
  );
}
