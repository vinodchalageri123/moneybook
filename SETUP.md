# Money Book: setup

Your database is already created and secured (Supabase project **moneybook**, Mumbai).
The app already knows your Project URL and publishable key, so you only enter your email and password.

## 1. Put the app online (GitHub Pages, free)
1. GitHub → New repository → name `moneybook` → Public → Create.
2. Upload every file from this folder **except** any backup `.json` file. Commit.
3. Repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` / root → Save.
4. Wait a minute. Your app is at `https://<your-github-username>.github.io/moneybook/`.

## 2. Tell Supabase where your app lives
Supabase dashboard → project **moneybook** → **Authentication → URL Configuration** → Site URL = your GitHub Pages link → Save.
(This makes the confirmation email open your app.)

## 3. Install on your phone and create your account
1. Open your GitHub Pages link in Chrome → ⋮ → **Install app** (or Add to Home screen).
2. Open Money Book → tap **Not synced · set up** at the top. URL and key are already filled in.
3. Enter your email and a strong password → **First time? Create account**.
4. Open the confirmation email, tap the link, come back → **Sign in**. The top shows **● Synced**.
5. Tell Claude "signed in". Claude loads your existing entries into the database for you.

## 4. Lock it down (important, 1 minute)
Supabase dashboard → project **moneybook** → **Authentication → Sign In / Providers** → turn **off "Allow new users to sign up"** → Save.
Now nobody else can create an account in your project, even if they find the app.

## Daily use
- **+ Add entry** → tap a button (Tea, Petrol, Lunch…) → amount → Save. Last amount is pre-filled.
- **＋ New** or **Edit buttons** → add your own button and a new category.
- Offline entries are saved on the phone and sync automatically when you're back online.
- Long-press the app icon → **Add spend** to jump straight in.
