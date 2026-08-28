import { useNavigate } from "react-router-dom";
import type { CreateEventInput } from "@event-planner/shared";

import { createEvent } from "../api/client.js";
import EventForm from "../components/EventForm.js";

export default function EventCreatePage() {
  const navigate = useNavigate();

  async function handleSubmit(input: CreateEventInput) {
    const event = await createEvent(input);

    navigate(`/events/${event.id}`, { replace: true });
  }

  return (
    <main className="page-body max-w-3xl">
      <h1 className="font-display text-4xl leading-tight text-ink">
        New event
      </h1>

      <EventForm
        submitLabel="Create event"
        onSubmit={handleSubmit}
        cancelTo="/events"
      />
    </main>
  );
}
