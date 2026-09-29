import { Overview } from "@/components/overview/Overview";
import { overviewDays } from "@/lib/mock/overview";

export const metadata = { title: "Home" };

export default function HomePage() {
  return <Overview days={overviewDays} />;
}
