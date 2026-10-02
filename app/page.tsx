import { redirect } from "next/navigation";

// The middleware normally redirects before this renders.
export default function HomePage() {
  redirect("/command-center");
}
