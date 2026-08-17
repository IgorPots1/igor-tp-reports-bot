import re, os

src = open('instagram-carousel-mockup.html', encoding='utf-8').read()
style = re.search(r'<style>(.*?)</style>', src, re.S).group(1)

slides, pos = [], 0
while True:
    i = src.find('<div class="slide', pos)
    if i == -1: break
    j = src.find('>', i); depth, k = 1, j + 1
    while depth > 0:
        nd, cd = src.find('<div', k), src.find('</div>', k)
        if cd == -1: break
        if nd != -1 and nd < cd: depth += 1; k = nd + 4
        else: depth -= 1; k = cd + 6
    slides.append(src[i:k]); pos = k

os.makedirs('export', exist_ok=True)
overrides = '''
  html,body{margin:0;padding:0;background:#0E1B2E;width:1080px;height:1350px;overflow:hidden}
  .stage{width:432px;height:540px;transform:scale(2.5);transform-origin:top left}
  .slide{width:432px !important;height:540px !important;aspect-ratio:auto !important;
         border-radius:0 !important;box-shadow:none !important;margin:0 !important}
'''
for n, sl in enumerate(slides, 1):
    page = ('<!doctype html><html><head><meta charset="utf-8"><style>' + style + overrides +
            '</style></head><body><div class="stage">' + sl + '</div></body></html>')
    open('export/slide-%02d.html' % n, 'w', encoding='utf-8').write(page)
print('слайдов:', len(slides))
