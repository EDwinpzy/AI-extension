"""Render the vector master and a light/dark, actual-size review sheet."""
from pathlib import Path
import io
import cairosvg
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'images/icon.svg'
SIZES = (16, 32, 48, 128)
for size in (*SIZES, 512):
    data = cairosvg.svg2png(url=str(SOURCE), output_width=size * 4, output_height=size * 4)
    icon = Image.open(io.BytesIO(data)).convert('RGBA').resize((size, size), Image.Resampling.LANCZOS)
    icon.save(ROOT / 'images' / f'icon{size}.png')

sheet = Image.new('RGB', (1000, 600), '#E9E6DE')
draw = ImageDraw.Draw(sheet)
draw.text((42, 28), 'AI-extension / FOLDED A', fill='#134E4A', font_size=26)
hero = Image.open(ROOT / 'images/icon512.png')
sheet.paste(hero.resize((320, 320), Image.Resampling.LANCZOS), (52, 124), hero.resize((320, 320), Image.Resampling.LANCZOS))
for y, bg, fg in ((112, '#FFFFFF', '#134E4A'), (326, '#172827', '#F5F2E9')):
    draw.rounded_rectangle((424, y, 958, y + 176), radius=18, fill=bg)
    x = 450
    for size in (128, 48, 32, 16):
        icon = Image.open(ROOT / 'images' / f'icon{size}.png')
        sheet.paste(icon, (x, y + 18 + (128-size)//2), icon)
        draw.text((x, y+150), f'{size}px', fill=fg, font_size=13)
        x += size + 36
draw.text((52, 538), 'Vector master / warm ivory / deep teal / terracotta', fill='#43635F', font_size=20)
sheet.save(ROOT / 'icon-lab/folded-a-preview.png')
for size in SIZES:
    with Image.open(ROOT / 'images' / f'icon{size}.png') as im:
        assert im.size == (size, size) and im.mode == 'RGBA'
print('Verified 16/32/48/128 PNGs; 512px master and review sheet generated.')
