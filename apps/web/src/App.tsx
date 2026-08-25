import { useEffect } from "react";
import { getMe } from "./api/client.js";

export default function App() {
  useEffect(() => {
    getMe()
      .then((result) => {
        console.log("Current user:", result.user);
      })
      .catch((error) => {
        console.error("getMe failed:", error);
      });
  }, []);

  return <div>Event Planner</div>;
}
