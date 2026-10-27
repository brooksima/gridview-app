#!/usr/bin/env bash
# Logged-out checks for the public demo: anon sees only Demo rows/files; no DTE data; all anon writes denied.
# Usage: ANON_KEY=... DTEPATHS='["<dte object path>",...]' tests/demo-anon.sh
U=${SUPABASE_URL:-https://gxpxidiinkjhnmnlhase.supabase.co}; K=${ANON_KEY:?set ANON_KEY (public anon key)}; H=(-H "apikey: $K" -H "Authorization: Bearer $K")
DEMO=8b3990cb-168e-48af-b62e-2b481da4ad7f; DTE=9ec651a7-e4a7-460a-8905-2eee5bbe7d57
echo "1 anon photos total visible:"; curl -s "${H[@]}" -H "Prefer: count=exact" -I "$U/rest/v1/photos?select=id" | grep -i content-range
echo "2 anon distinct company_ids:"; curl -s "${H[@]}" "$U/rest/v1/photos?select=company_id" | jq -c '[.[].company_id]|unique'
echo "3 anon DTE rows:"; curl -s "${H[@]}" "$U/rest/v1/photos?select=id&company_id=eq.$DTE" | jq -c .
echo "4 anon profiles:"; curl -s "${H[@]}" "$U/rest/v1/profiles?select=id,email" | jq -c .
DP=$(curl -s "${H[@]}" "$U/rest/v1/photos?select=storage_path,thumb_path&limit=1" | jq -r '.[0].storage_path'); DT=$(curl -s "${H[@]}" "$U/rest/v1/photos?select=thumb_path&limit=1" | jq -r '.[0].thumb_path')
echo "5 sign demo full+thumb:"; S=$(curl -s "${H[@]}" -H 'content-type: application/json' -X POST "$U/storage/v1/object/sign/photos" -d "{\"expiresIn\":600,\"paths\":[\"$DP\",\"$DT\"]}"); echo "$S" | jq -c '[.[]|{error, ok:(.signedURL!=null)}]'
URL=$(echo "$S" | jq -r '.[0].signedURL'); curl -s -o /tmp/d.jpg -w "   fetch full: %{http_code} %{content_type} %{size_download}B\n" "$U/storage/v1$URL"
echo "6 anon DTE storage list:"; curl -s "${H[@]}" -H 'content-type: application/json' -X POST "$U/storage/v1/object/list/photos" -d "{\"prefix\":\"$DTE/\",\"limit\":100}" | jq -c 'if type=="array" then length else . end'
echo "7 anon root list:"; curl -s "${H[@]}" -H 'content-type: application/json' -X POST "$U/storage/v1/object/list/photos" -d '{"prefix":"","limit":100}' | jq -c '[.[]?.name]'
echo "8 anon sign DTE objects (paths from DB passed in):"; curl -s "${H[@]}" -H 'content-type: application/json' -X POST "$U/storage/v1/object/sign/photos" -d "{\"expiresIn\":600,\"paths\":$DTEPATHS}" | jq -c '[.[]?|{error, ok:(.signedURL!=null)}] // .'
echo "8b anon direct authenticated GET of a DTE object:"; curl -s -o /dev/null -w "%{http_code}\n" "${H[@]}" "$U/storage/v1/object/authenticated/photos/$(echo $DTEPATHS | jq -r '.[0]')"
echo "8c anon public URL of a DTE object:"; curl -s -o /dev/null -w "%{http_code}\n" "$U/storage/v1/object/public/photos/$(echo $DTEPATHS | jq -r '.[0]')"
echo "9 anon INSERT photo:"; curl -s "${H[@]}" -H 'content-type: application/json' -X POST "$U/rest/v1/photos" -d "{\"company_id\":\"$DEMO\",\"storage_path\":\"x/hack.jpg\",\"pilot_id\":\"00000000-0000-0000-0000-000000000000\"}" | jq -c '{code,message}'
echo "10 anon UPDATE demo photo:"; curl -s "${H[@]}" -H 'content-type: application/json' -H 'Prefer: return=representation' -X PATCH "$U/rest/v1/photos?company_id=eq.$DEMO" -d '{"issue":"hacked"}' | jq -c 'if type=="array" then "rows changed: \(length)" else . end'
echo "11 anon DELETE demo photo:"; curl -s "${H[@]}" -H 'Prefer: return=representation' -X DELETE "$U/rest/v1/photos?company_id=eq.$DEMO" | jq -c 'if type=="array" then "rows deleted: \(length)" else . end'
echo "12 anon upload to Demo folder:"; curl -s "${H[@]}" -H 'content-type: image/jpeg' -X POST "$U/storage/v1/object/photos/$DEMO/hack.jpg" --data-binary 'x' | jq -c .
echo "13 anon delete demo object:"; curl -s "${H[@]}" -H 'content-type: application/json' -X DELETE "$U/storage/v1/object/photos" -d "{\"prefixes\":[\"$DP\"]}" | jq -c 'if type=="array" then "objects deleted: \(length)" else . end'
echo "14 anon update company:"; curl -s "${H[@]}" -H 'content-type: application/json' -H 'Prefer: return=representation' -X PATCH "$U/rest/v1/companies?id=eq.$DEMO" -d '{"name":"x"}' | jq -c 'if type=="array" then "rows changed: \(length)" else . end'
echo "15 anon pilot_names rpc:"; curl -s "${H[@]}" -H 'content-type: application/json' -X POST "$U/rest/v1/rpc/pilot_names" -d '{"ids":[]}' | jq -c '{code,message}'
