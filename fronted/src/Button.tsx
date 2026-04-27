import React, { ButtonHTMLAttributes } from 'react';

// 1. הגדרת המאפיינים (Props) שלנו על ידי הרחבת מאפייני הכפתור הסטנדרטיים
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: 'primary' | 'secondary' | 'danger' | string; // עדיף להשתמש בערכים ספציפיים מאשר סתם 'string'
}

// 2. החלת ה-Interface על הקומפוננטה
const Button = ({ variant, children, ...rest }: ButtonProps) => {
  return (
    // 3. שימוש ב-variant (למשל עבור class) והעברת שאר המאפיינים (כמו onClick, disabled) הלאה לאלמנט עצמו
    <button className={`btn ${variant}`} {...rest}>
      {children}
    </button>
  );
};

export default Button;