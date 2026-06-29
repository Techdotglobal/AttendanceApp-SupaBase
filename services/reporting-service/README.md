# Reporting Service

Microservice for generating and emailing attendance, leave, and ticket reports.

## Setup

1. **Install Dependencies**
   ```bash
   cd services/reporting-service
   npm install
   ```

2. **Configure Environment Variables**
   
   Create a `.env` file in `services/reporting-service/`:
   ```env
   PORT=3002
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   
   # Email Configuration (Gmail SMTP via Nodemailer)
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-gmail-account@gmail.com
   SMTP_PASS=your-gmail-app-password
   # Optional: override From address (defaults to SMTP_USER)
   # EMAIL_FROM=reports@yourdomain.com
   ```

3. **Start the Service**
   ```bash
   npm start
   # or
   npm run dev
   ```

The service will start on port 3002 (or the port specified in the `PORT` environment variable).

## Features

- **Automatic Monthly Reports**: Generates and emails monthly reports on the 1st of every month at 2:00 AM UTC
- **Manual Report Generation**: API endpoint for on-demand report generation
- **Multiple Report Types**: Weekly, Monthly, Yearly, All-time, and Custom date ranges
- **PDF Generation**: Professional PDF reports with company-wide and department-wise statistics
- **Email Delivery**: Sends reports via email to Super Admin

## Endpoints

- `POST /api/reports/generate` - Generate a report manually
- `GET /api/reports/health` - Health check
- `GET /health` - Service health check
- `GET /` - Service information

## Report Generation

### Manual Report Generation

**Endpoint:** `POST /api/reports/generate`

**Headers:**
- `x-user-id`: User ID (for authentication)
- `x-user-email`: User email (alternative authentication)

**Request Body:**
```json
{
  "range": "weekly | monthly | yearly | all | custom",
  "from": "2026-01-01",  // Optional, required for custom
  "to": "2026-01-31"      // Optional, required for custom
}
```

**Response:**
```json
{
  "success": true,
  "message": "Report generation started. You will receive the report via email shortly.",
  "timestamp": "2026-01-01T12:00:00.000Z"
}
```

**Note:** Report generation happens asynchronously. The API returns immediately, and the report is sent via email when ready.

## Security

- Only Super Admins can generate reports
- Uses Supabase Service Role Key for read-only database access
- Service Role Key never exposed to frontend
- All database queries are read-only

## Monthly Report Job

The service automatically generates and emails monthly reports on the 1st of every month at 2:00 AM UTC. The report covers the previous month's data.

## Email Configuration

The service sends report emails via **Gmail SMTP** using [Nodemailer](https://nodemailer.com).

### Setup Steps

1. **Create or use a dedicated Gmail account** for sending reports.
2. **Enable 2-Step Verification** on the Google account.
3. **Generate an App Password** at https://myaccount.google.com/apppasswords
4. **Set environment variables on Render** (or in `.env` locally):
   - `SMTP_HOST`: `smtp.gmail.com` (default)
   - `SMTP_PORT`: `587` (default; use `465` for implicit TLS)
   - `SMTP_USER`: Gmail account address
   - `SMTP_PASS`: Gmail app password (not your regular login password)
   - `EMAIL_FROM` (optional): From address shown to recipients (defaults to `SMTP_USER`)

### Gmail App Password Notes

- Use a dedicated account — do not use a personal inbox.
- App passwords are required when 2FA is enabled.
- Never commit credentials to the repository.

## Troubleshooting

### Email Not Sending

1. Verify `SMTP_USER` and `SMTP_PASS` are set correctly in environment variables
2. Confirm the Gmail app password is valid (regenerate if unsure)
3. Check that `SMTP_HOST` is `smtp.gmail.com` and `SMTP_PORT` is `587`
4. Review service logs for `[SUCCESS]` / `[FAILURE]` email delivery entries
5. Check Gmail "Sent" folder on the sending account for delivery attempts

### Report Generation Fails

1. Verify Supabase credentials are correct
2. Check database connection
3. Ensure Service Role Key has read access to all tables
4. Review service logs for detailed error messages

