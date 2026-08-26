import { useNavigate } from "react-router-dom";
import type { CreateEventInput } from "@event-planner/shared";

import { createEvent } from "../api/client.js";
import EventForm from "../components/EventForm.js";

export default function EventCreatePage() {
  const navigate = useNavigate();

  // Navigating here is the same documented exception as the delete handler
  // (D025): it goes to the URL of a resource that did not exist until this
  // request succeeded, which is not an auth transition and which no route
  // guard can observe.
  async function handleSubmit(input: CreateEventInput) {
    const event = await createEvent(input);

    navigate(`/events/${event.id}`, { replace: true });
  }

  return (
    <main>
      <h1>New event</h1>

      <EventForm
        submitLabel="Create event"
        onSubmit={handleSubmit}
        cancelTo="/events"
      />
    </main>
  );
}
