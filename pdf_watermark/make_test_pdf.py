"""產生一份含多種頁面尺寸的測試 PDF：sample.pdf"""

import io

from pypdf import PdfReader, PdfWriter, Transformation
from reportlab.lib.pagesizes import A3, A4, A5, letter, landscape
from reportlab.pdfgen import canvas

PAGES = [
    ("A4 portrait", A4),
    ("A4 landscape", landscape(A4)),
    ("US Letter", letter),
    ("A3", A3),
    ("A5", A5),
    ("Banner 1000x200", (1000, 200)),
    ("A4 with /Rotate 90", A4),
    ("A4 with offset MediaBox", A4),
]


def main() -> None:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i, (label, size) in enumerate(PAGES, start=1):
        w, h = size
        c.setPageSize(size)
        c.setStrokeColorRGB(0.2, 0.4, 0.8)
        c.rect(10, 10, w - 20, h - 20)
        c.setFont("Helvetica-Bold", 18)
        c.drawString(30, h - 45, f"Page {i}: {label}")
        c.setFont("Helvetica", 11)
        c.drawString(30, h - 65, f"Size: {w:.0f} x {h:.0f} pt")
        y = h - 90
        while y > 30:
            c.drawString(30, y, "Lorem ipsum dolor sit amet, consectetur adipiscing elit.")
            y -= 16
        c.showPage()
    c.save()

    buf.seek(0)
    writer = PdfWriter(clone_from=PdfReader(buf))
    writer.pages[6].rotate(90)
    # 第 8 頁：把內容與 MediaBox 一起平移，使原點不在 (0, 0)
    p = writer.pages[7]
    p.add_transformation(Transformation().translate(100, 50))
    p.mediabox.lower_left = (100, 50)
    p.mediabox.upper_right = (100 + A4[0], 50 + A4[1])

    with open("sample.pdf", "wb") as f:
        writer.write(f)
    print("已產生 sample.pdf")


if __name__ == "__main__":
    main()
