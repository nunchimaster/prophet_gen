export const metadata = {
  title: "Prophet 모델 명세서 생성기",
  description: "약관 PDF를 올리면 Prophet 모델 명세서 초안을 생성합니다.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
