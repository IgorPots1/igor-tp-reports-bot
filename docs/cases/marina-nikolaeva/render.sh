#!/bin/sh
# рендер слайда: окно на 87px выше, чтобы область отрисовки была ровно 1350, затем обрезка
cd "$(dirname "$0")/export"
for n in 01 02 03 04 05 06 07 08 09; do
  /opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless --no-sandbox --disable-gpu \
    --hide-scrollbars --allow-file-access-from-files --window-size=1080,1437 \
    --screenshot="raw-$n.png" "file://$PWD/slide-$n.html" 2>/dev/null
  python3 ../pngcrop.py "raw-$n.png" "marina-$n.png" 1350 >/dev/null
  rm -f "raw-$n.png"
done
