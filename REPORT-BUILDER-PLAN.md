# Report Builder — A to B

Rewritten Oct 20, 2026 after Tim's corrections. Short on purpose.

**B is:** open Report Builder on a real job and find the report 80–90% built,
with every piece in the same place every time, and everything movable and
editable from there.

**The rules, in Tim's words, that the four jobs below follow:**

- "Everything needs to be movable and editable."
- "Report Builder needs to bring things in perfectly, or at least in the same
  place every single time. The pill size, the legend, the map, they all should
  be able to line up exactly."
- Chevrons are the resize pull, **and they only show up when the box is
  highlighted, period.**
- Circles on corners were removed. The subject is closed.
- "If you clip the picture the exact same size every fucking time, the middle
  never changes." Knowing a wall's dimensions was never needed; an identical
  plate is.
- "I want to shrink the font." Captions shrink to fit under an identical
  plate.

---

## 1. The site overview on Tim's cover

**Measured, and my earlier claim was wrong.** On a cover with an address the
Open in Google Maps link renders, the overview box renders at its home in the
lower right, and the dashed placeholder renders -- on first open and after a
reopen. The probe that reported the link "missing" was run against a browser
holding no Customer File at all, so there was no address and therefore no
link. A false reading, turned into a plan item.

What is still true is that the same area on Tim's own cover is blank: no box,
no placeholder, no link. So it is that file's saved cover layout, not the
feature. One check settles it -- click the blank space under CONTENTS: pulls
appearing means the box is there and empty; nothing appearing means it is not
being drawn.

Until that is known, this is not work to do. It is a question to answer.

## 2. Every piece lands in the same place, every time — **done, Oct 20**

The colour scale, the H/L/Δ pill and the aerial each have a home on a Floor
Survey sheet. On a two-boundary sheet the second scale currently runs off the
bottom of the paper, and the pills sit away from their scales.

One placement rule, applied the same way whatever the sheet holds: each
boundary's scale and its pill together, never off the paper, identical from
sheet to sheet. Moved afterwards by hand, because everything is movable.

## 3. Pictures line up — **done, Oct 20**

Every plate is clipped to the identical box, so the centre is the same on
every picture and the rows line up. The caption sits under it and its font
shrinks to fit rather than pushing the picture around.

## 4. Chevron pulls, on anything that moves — **done, Oct 20**

The resize pull is a chevron, on every movable box on every sheet — cover,
figure, pictures, text. It appears when the box is highlighted and at no other
time, and never prints.

---

## What those three became, in the code

**2.** Each boundary's scale and pill sit together in a slot measured from the
real height of a colour scale, and a report saved under the old guessed slots
takes the corrected one unless the position was chosen by hand. On top of
that, Tim's decisions of Oct 20: Main Level leads, the everything-at-once
sheet comes last as *Combined View for Exhibit* and carries no scale and no
pill, a garage arrives as readings rather than contours, and any sheet drawn
as readings alone drops the colour scale with it.

**3.** The caption is a block of fixed height in every cell, three lines deep.
The words fit it by coming down in size, to half at the floor, and the plate
above never moves — so the pictures along a row sit on one line. The printed
deck measures its own captions, which it had never done.

**4.** A pull shows on the box being worked on and on no other, on the cover,
on a Floor Survey sheet and on a Picture Locations sheet alike. Hover does
nothing. Nothing prints.

**Still Tim's to settle:** whether a photograph is *cropped* to fill the
identical plate or *fitted* inside it. Cropping makes every picture literally
the same rectangle; it also cuts evidence off the edge of a photograph. Not
mine to choose.

---

## Then

Promote, Tim looks at a real job, and what is left is the composition pass he
has to drive: the cover he has said twice he does not like, and the Discussion
page that was never rebuilt. That is "screenshot → match → accept on a real
Customer File", which is the loop `DECISIONS.md` already sets out.
