# CSS Structure

## โครงสร้าง

```
styles/
├── index.css          # Entry - import ทุกไฟล์
├── globals.css        # Tailwind + base
├── variables.css      # Design tokens (สี, radius)
├── components/        # คลาส reusable
│   ├── button.css
│   ├── input.css
│   ├── card.css
│   ├── modal.css
│   └── skeleton.css
└── pages/             # คลาสเฉพาะหน้า
    ├── home.css
    ├── login.css
    ├── select-shop.css
    ├── select-branch.css
    └── pos.css
```

## วิธีเพิ่ม CSS ใหม่

1. **Component ทั่วไป** → สร้าง `components/ชื่อ-component.css` แล้ว import ใน index.css
2. **หน้าใหม่** → สร้าง `pages/ชื่อ-page.css` แล้ว import ใน index.css
3. **BEM naming** → `page-name__element--modifier` (เช่น `page-pos__cart-item`)
4. **Design token** → เพิ่มใน variables.css
