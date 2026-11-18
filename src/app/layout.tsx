import "./globals.css";
import "./states.css";
export const metadata = {
  title: "FollowersOnly — Your people. Your space.",
  description: "A closer connection to the creators you love.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
