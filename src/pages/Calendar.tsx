import { Card } from '@mantine/core';
import { PageHeader } from '../components/common';
import { CalendarSheet } from '../components/calendar/CalendarSheet';

// The team's monitoring schedule for the year, laid out like the spreadsheet – and linked to the projects.
export function CalendarPage() {
  return (
    <>
      <PageHeader
        title="Monitoring calendar"
        description="The team’s monitoring schedule, like the spreadsheet: a row per job, what’s planned each month, coloured as it’s done this year. Rows for projects show when results came in and the reports due."
      />
      <Card p="sm">
        <CalendarSheet />
      </Card>
    </>
  );
}
