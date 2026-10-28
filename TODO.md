# TODO

## 1. Finish the large-screen pass
- [ ] Check `/`, `/search`, `/routes/[id]` and the explore/map view at ~1280, 1440 and 1920px
- [ ] Re-check the same pages at tablet and phone widths for regressions

## 2. Check the new logo and icons
- [ ] `logo.png` and `logo-mark.png` look sharp in the header at every size
- [ ] Mobile nav shows the right logo
- [ ] Favicon, `icon.png` and `apple-icon.png` show in the browser tab (hard refresh, favicons are cached)
- [ ] Compress/resize the logo PNGs (~700-960 KB each) if they slow page load

## 3. Check the search form and button changes
- [ ] Place input, transport filter and search button work on desktop and mobile
- [ ] Keyboard use works (tab order, Enter to submit)

## 4. Run checks before committing
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run` (confirm `explore-view.test.tsx` still passes)
- [ ] `npm run build`

## 5. Commit and deploy
- [ ] Commit with clear messages
- [ ] Push and open the preview deployment on a phone

## 6. Optional follow-ups
- [ ] Sample-data banner and verification notices read well on wide screens
- [ ] Fare display (`trip-fare.tsx`) looks right on narrow screens
