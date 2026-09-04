import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new Response("Unauthorized", { status: 401 })

    const { data: profile } = await supabase.from('users').select('tenant_id, role').eq('id', user.id).single()
    const adminAccessRoles = ["admin", "super_admin", "tenant_admin", "team_leader"]
    if (!profile || !adminAccessRoles.includes(profile.role)) {
      return new Response("Unauthorized", { status: 403 })
    }
    if (!profile.tenant_id) {
      return new Response("Missing tenant configuration", { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")

    let query = supabase.from("leads").select("*, assigned_user:users!leads_assigned_to_fkey(full_name)").eq('tenant_id', profile.tenant_id)
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data: leads, error } = await query.limit(50000)
    
    if (error) throw error

    if (!leads || leads.length === 0) {
      return new Response("No leads found for this status.", { status: 404 })
    }

    const headers = ["Name", "Phone", "Email", "Company", "Status", "Priority", "Score", "Created At", "Last Contacted", "Source", "Assigned To", "Tags", "Notes"]
    const csvRows = [headers.join(",")]

    for (const lead of leads) {
      const assignedName = Array.isArray(lead.assigned_user) ? (lead.assigned_user[0]?.full_name) : (lead.assigned_user?.full_name || lead.assigned_to || "")
      const tags = Array.isArray(lead.tags) ? lead.tags.join('; ') : lead.tags
      
      const row = [
        `"${(lead.name || '').replace(/"/g, '""')}"`,
        `"${(lead.phone || '').replace(/"/g, '""')}"`,
        `"${(lead.email || '').replace(/"/g, '""')}"`,
        `"${(lead.company || '').replace(/"/g, '""')}"`,
        `"${(lead.status || '').replace(/"/g, '""')}"`,
        `"${(lead.priority || '').replace(/"/g, '""')}"`,
        `"${lead.lead_score || ''}"`,
        `"${lead.created_at || ''}"`,
        `"${lead.last_contacted || ''}"`,
        `"${(lead.source || '').replace(/"/g, '""')}"`,
        `"${(assignedName || '').replace(/"/g, '""')}"`,
        `"${(tags || '').replace(/"/g, '""')}"`,
        `"${(lead.notes || '').replace(/"/g, '""')}"`
      ]
      csvRows.push(row.join(","))
    }

    const csvString = csvRows.join("\n")

    return new Response(csvString, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="leads-export-${status || 'all'}-${new Date().toISOString().split('T')[0]}.csv"`
      }
    })

  } catch (err: any) {
    console.error("Export error:", err)
    return new Response("Error exporting leads: " + err.message, { status: 500 })
  }
}
