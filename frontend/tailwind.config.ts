import type { Config } from 'tailwindcss';

/**
 * Token không nằm ở đây mà ở `app/globals.css` (CSS custom properties): mọi
 * component chỉ tham chiếu token, không hard-code mã màu. Tailwind chỉ ánh xạ
 * tên token sang utility.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        field: 'var(--field)',
        'field-soft': 'var(--field-soft)',
        'field-strong': 'var(--field-strong)',
        ink: 'var(--ink)',
        'ink-soft': 'var(--ink-soft)',
        'ink-faint': 'var(--ink-faint)',
        rule: 'var(--rule)',
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      /*
       * Sáu bước chữ của showroom. Phải khai báo ở theme thay vì dùng
       * `text-[var(--step-x)]`: gặp arbitrary value chỉ là một `var()`,
       * Tailwind suy luận đó là MÀU nên cỡ chữ lặng lẽ không được áp dụng.
       */
      fontSize: {
        small: 'var(--step-small)',
        note: 'var(--step-note)',
        body: 'var(--step-body)',
        lead: 'var(--step-lead)',
        title: 'var(--step-title)',
        display: 'var(--step-display)',
      },
      borderRadius: {
        // Một bán kính duy nhất cho toàn trang.
        card: '20px',
      },
      maxWidth: {
        reading: '46ch',
        shelf: '1280px',
      },
      keyframes: {
        /*
         * Nhịp thở chậm cho skeleton: đủ để báo "đang tải", không phải một
         * animation đòi sự chú ý (skill cấm pulse/bounce/ping).
         */
        breathe: {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '0.9' },
        },
      },
      animation: {
        breathe: 'breathe 3.4s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
