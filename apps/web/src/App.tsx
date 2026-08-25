import { useAuth } from "./auth/AuthContext.js";

export default function App() {
  const { status, user, logout } = useAuth();

  if (status === "loading") {
    return <p>Loading…</p>;
  }

  if (status === "anonymous") {
    return <p>Not signed in.</p>;
  }

  return (
    <div>
      <p>Signed in as {user?.name}</p>
      <button onClick={() => void logout()}>Log out</button>
    </div>
  );
}
