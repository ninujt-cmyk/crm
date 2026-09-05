import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Helper to lazy-load the Supabase Admin Client to bypass RLS for webhooks
// This prevents Next.js build-time errors when env variables are missing during static analysis.
const getSupabaseAdmin = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  )
}

export async function POST(req: Request) {
    return handleWebhook(req);
}

export async function GET(req: Request) {
    return handleWebhook(req);
}

async function handleWebhook(req: Request) {
  try {
    const url = new URL(req.url);
    const searchParams = url.searchParams;
    
    // 0. API Key Verification
    const expectedApiKey = process.env.CLOUDCONNECT_WEBHOOK_SECRET || 'your-default-secure-api-key';
    const providedApiKey = searchParams.get('api_key') || req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');

    if (providedApiKey !== expectedApiKey) {
        return NextResponse.json({ error: 'Unauthorized: Invalid API Key' }, { status: 401 });
    }
    
    // Parse Payload (CloudConnect usually sends via Query Params for Webhooks)
    const uuid = searchParams.get('uuid') || '';
    const extensionNumber = searchParams.get('extension_number') || searchParams.get('agent_id') || '';
    const callerNumber = searchParams.get('caller_number') || '';
    const callStatus = searchParams.get('call_status') || ''; // 'Ring', 'Answered', 'Hangup'
    const callDirection = searchParams.get('call_direction') || ''; // 'inbound', 'outbound'
    const callDuration = searchParams.get('call_duration') || '0';
    const dtmfInput = searchParams.get('dtmf_input') || searchParams.get('digit') || '';

    if (!uuid || !callerNumber) {
        return NextResponse.json({ error: 'Missing required parameters (uuid, caller_number)' }, { status: 400 });
    }

    // 1. Find the Lead
    // Format the number to get the last 10 digits for better matching
    const cleanNumber = callerNumber.replace(/^\+?\d{1,3}/, '').slice(-10); 
    
    const supabaseAdmin = getSupabaseAdmin();
    
    const { data: leads } = await supabaseAdmin
        .from('leads')
        .select('id, name, company, phone, status')
        .ilike('phone', `%${cleanNumber}%`)
        .limit(1);

    const lead = leads?.[0];

    // 2. Handle RINGING (Screen Pop)
    if (callStatus === 'Ring') {
        const payload = {
            call_uuid: uuid,
            extension: extensionNumber,
            caller_number: callerNumber,
            direction: callDirection,
            lead: lead || null, 
        };

        // Broadcast to Supabase Realtime channel
        const channel = supabaseAdmin.channel('cloudconnect_events');
        await channel.send({
            type: 'broadcast',
            event: 'SCREEN_POP',
            payload: payload
        });
        
        return NextResponse.json({ success: true, message: 'Ringing event broadcasted' });
    }

    // 3. Handle HANGUP or ANSWERED (Log Call)
    if (callStatus === 'Hangup' || callStatus === 'Answered') {
        const { data: existingLog } = await supabaseAdmin
            .from('call_logs')
            .select('id')
            .eq('cloudconnect_uuid', uuid)
            .single();

        const logData: any = {
            cloudconnect_uuid: uuid,
            call_type: callDirection.toLowerCase() || 'unknown',
            call_status: callStatus.toLowerCase(),
            duration_seconds: parseInt(callDuration, 10) || 0,
            notes: `CloudConnect Call (${callStatus}). Ext: ${extensionNumber}`
        };

        if (dtmfInput) {
            logData.notes += ` | DTMF Input: ${dtmfInput}`;
        }

        if (lead?.id) {
            logData.lead_id = lead.id;
            
            // If they pressed 1 or 2, they are interested or need more info
            if (dtmfInput === '1' || dtmfInput === '2') {
                await supabaseAdmin.from('leads').update({ status: 'Interested' }).eq('id', lead.id);
            } else if (dtmfInput === '3') {
                await supabaseAdmin.from('leads').update({ status: 'Not Interested' }).eq('id', lead.id);
            }
        }

        if (existingLog) {
            await supabaseAdmin.from('call_logs').update(logData).eq('id', existingLog.id);
        } else {
            await supabaseAdmin.from('call_logs').insert([logData]);
        }

        return NextResponse.json({ success: true, message: 'Call log saved' });
    }

    return NextResponse.json({ success: true, message: 'Event ignored' });

  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
