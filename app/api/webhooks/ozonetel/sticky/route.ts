import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase Admin Client to bypass RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(req: Request) {
    return handleStickyRouting(req);
}

export async function POST(req: Request) {
    return handleStickyRouting(req);
}

async function handleStickyRouting(req: Request) {
    try {
        const url = new URL(req.url);
        const searchParams = url.searchParams;
        
        // API Key Verification
        const expectedApiKey = process.env.CLOUDCONNECT_WEBHOOK_SECRET || 'HANVA_OZT_7X9Q2P4L';
        const providedApiKey = searchParams.get('api_key') || req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');

        if (providedApiKey !== expectedApiKey) {
            return NextResponse.json({ error: 'Unauthorized: Invalid API Key' }, { status: 401 });
        }

        // Ozonetel will pass the customer's phone number, e.g., ?caller_number=9876543210
        const callerNumber = searchParams.get('caller_number') || searchParams.get('cid') || '';
        if (!callerNumber) {
            return NextResponse.json({ error: 'Missing caller_number parameter' }, { status: 400 });
        }

        const cleanNumber = callerNumber.replace(/^\+?\d{1,3}/, '').slice(-10);

        // 1. Look up the lead to find the assigned agent
        const { data: leads } = await supabaseAdmin
            .from('leads')
            .select('assigned_to')
            .ilike('phone', `%${cleanNumber}%`)
            .limit(1);

        const lead = leads?.[0];
        
        if (!lead || !lead.assigned_to) {
            // No lead found or no assigned agent. Return empty so Ozonetel falls back to common skill
            return NextResponse.json({ phone_name: "" });
        }

        // 2. Look up the agent's mobile number
        const { data: user } = await supabaseAdmin
            .from('users')
            .select('phone') // Assuming 'phone' column exists for agent's mobile
            .eq('id', lead.assigned_to)
            .single();

        if (user && user.phone) {
            // Return the agent's phone number as 'phone_name' for Ozonetel's skill-based routing
            return NextResponse.json({ phone_name: user.phone });
        }

        // Fallback
        return NextResponse.json({ phone_name: "" });

    } catch (error: any) {
        console.error('Ozonetel Sticky API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
