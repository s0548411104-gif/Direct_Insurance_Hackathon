import os
import json
import copy
import ssl
import urllib3
import requests
import asyncio
import uvicorn
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, Tuple, List

# --- הוסף את השורה הזו ---
from dotenv import load_dotenv 

# AI Libraries
from google import genai
from google.genai import types
import anthropic

# ==========================================
# 🚀 שלב 0: טעינת משתני סביבה (חובה!)
# ==========================================
load_dotenv() # טוען את קובץ ה-.env שנמצא באותה תיקייה

# ==========================================
# 🚀 שלב 1: הגדרות תשתית ועקיפת SSL
# ==========================================
# ... שאר הקוד שלך (עקיפת SSL וכו')


orig_create_default_context = ssl.create_default_context
def patched_create_default_context(*args, **kwargs):
    context = orig_create_default_context(*args, **kwargs)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context

ssl.create_default_context = patched_create_default_context
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
os.environ['PYTHONHTTPSVERIFY'] = '0'


app = FastAPI(title="DirectAI - Underwriting Engine")

# כעת os.getenv יצליח למשוך את המפתחות
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
CLAUDE_KEY = os.getenv("CLAUDE_API_KEY")

# בדיקת תקינות קטנה (מומלץ)
if not GEMINI_KEY:
    print("⚠️ אזהרה: מפתח GEMINI_API_KEY לא נמצא בקובץ ה-.env")

# ==========================================
# 📥 ה-JSON המלא של ה-CRM (Data)
# ==========================================
SAMPLE_CRM_DATA = {
  "session_id": "INS-77421-B",
  "timestamp": "2026-04-19T14:30:15Z",
  "customer_details": {
    "first_name": "אבי",
    "last_name": "כהן",
    "id_number": "217689754",
    "phone_number": "050-1234567",
    "email": "avi.cohen@gmail.com",
    "date_of_birth": "1980-01-01"
  },
  "property_details": {
    "city": "תל אביב",
    "street": "סוקולוב",
    "house_number": "7",
    "apartment_number": "1",
    "floor": "1",
    "total_floors": "2",
    "property_type": "וילה יוקרתית",
    "ownership_status": "בבעלות",
    "year_built": "2006"
  },
  "property_characteristics": {
    "area_sqm": 120,
    "rooms": 2,
    "bathrooms": 2,
    "has_balcony": True,
    "balcony_area_sqm": 20,
    "has_storage_room": True,
    "has_parking": True,
    "declared_finish_level": "מגורים בבית וכן קיימת פרגולה"
  },
  "security_and_safety": {
    "main_door_type": "פלדלת",
    "has_window_bars": True,
    "has_alarm_system": True,
    "has_safe": False,
    "has_smoke_detectors": True
  },
  "requested_coverage": {
    "structure_insurance": True,
    "contents_insurance": True,
    "contents_estimated_value": 250000,
    "include_earthquake": True,
    "include_water_damage": True,
    "third_party_liability_limit": 1000000
  },
  "underwriting_questions": {
    "claims_last_3_years": 0,
    "property_used_for_business": True,
    "is_unoccupied_frequently": False
  },
  "pricing_result": {
    "quote_id": "Q-998877",
    "status": "pending_ai_review",
    "base_annual_premium": 2400,
    "discounts_applied": {
      "no_claims_discount": 15,
      "online_purchase_discount": 10
    },
    "final_annual_premium": 1800,
    "final_monthly_premium": 150,
    "currency": "ILS",
    "valid_until": "2026-05-19"
  }
}

# ==========================================
# 📚 שלב 2: סכמת הנתונים Enterprise של ג'מיני
# ==========================================
class VisionFinding(BaseModel):
    detected: Optional[bool] = Field(description="True if definitively detected, False if definitively not, null if UNKNOWN/NOT ENOUGH DATA.")
    confidence: float = Field(description="Confidence score between 0.0 and 1.0. If detected is null, confidence must be low.")
    evidence: str = Field(description="Explicit visual evidence justifying the decision. Must cite specific pixels/objects.")

class VisionObservations(BaseModel):
    is_valid_property: bool = Field(description="CRITICAL: True if the media actually shows a house, apartment, or real estate property. False if it shows random objects, people, memes, or completely unrelated scenes.")
    invalid_property_reason: Optional[str] = Field(description="If is_valid_property is False, explain what was seen instead.")
    
    is_expected_room: bool = Field(description="True if the image matches the expected room requested by the system. False otherwise.")
    room_mismatch_reason: Optional[str] = Field(description="If is_expected_room is False, explain why.")
    
    visual_evidence_log: str = Field(description="Detailed sequential description of all areas seen across all passes.")
    identified_areas: list[str] = Field(description="List of definitively identified areas (e.g., Kitchen, Living Room).")
    
    is_empty_of_furniture: VisionFinding
    visible_moisture_or_mold: VisionFinding
    visible_severe_damage_or_wear: VisionFinding
    pergola_detected: VisionFinding
    high_value_items_in_storage_detected: VisionFinding
    multiple_entrance_doors_detected: VisionFinding
    commercial_or_industrial_equipment_detected: VisionFinding
    high_end_materials_or_smart_home_detected: VisionFinding
    pool_or_jacuzzi_detected: VisionFinding
    
    estimated_occupants_based_on_beds_and_items: Optional[int] = Field(description="Estimate ONLY if clear indicators exist. Null if unknown.")
    estimated_age_years: Optional[int] = Field(description="Rough visual estimate. Null if exterior is invisible.")
    estimated_area_sqm: Optional[int] = Field(description="Extremely rough estimate based on depth/FOV. Null if too uncertain.")

# ==========================================
# 👁️ שלב 3: ה-Agent של ג'מיני (Vision by Gemini)
# ==========================================
class GeminiVisionAgent:
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.model_name = "gemini-3.1-pro-preview"

    def build_prompt(self, expected_room: str) -> str:
        return f"""
        You are a certified, meticulous insurance field inspector.
        
        EXPECTED ROOM TO VALIDATE: {expected_room}
        
        CRITICAL FIRST STEP: Validate the media. Does it actually show a property (house, apartment, building exterior/interior)? If it shows completely unrelated content, you MUST set 'is_valid_property' to false and explain why.
        CRITICAL SECOND STEP: Verify if the space shown is indeed the '{expected_room}'. If not, set 'is_expected_room' to false.

        IMPORTANT ROOM-MATCH GUIDELINE (OPEN-SPACE HOMES):
        If the expected room is a Living Room / Salon and the image shows an open-space main area where a large dining table and chairs are visible (and possibly the kitchen in the background), this can STILL be considered a valid match.
        Many homes have a combined Salon + Dining area + Kitchen. Do NOT mark it as mismatch only because a dining table is prominent.
        Mark mismatch only if the scene clearly indicates a different dedicated room (e.g., bathroom fixtures, a bedroom with bed as the main subject, a balcony/outdoor area, storage room).
        
        You MUST adhere to the following strict guidelines:
        - NEVER guess. If a detail is out of frame, obscured, or ambiguous, return null (UNKNOWN) for 'detected'.
        - Provide explicit 'evidence' for EVERY decision.
        - Perform a MULTI-PASS analysis.
        
        CRITICAL DEFINITIONS:
        - "high_value_items_in_storage": Expensive tools, servers, or massive inventory specifically in a storage room.
        - "multiple_entrance_doors": More than one main entry door suggesting split units.
        - "commercial_equipment": Industrial tools, professional waiting areas. Normal home offices do NOT count.
        """

    def process_and_analyze(self, image_bytes: bytes, expected_room: str):
        request_parts = [
            types.Part.from_text(text=self.build_prompt(expected_room)),
            types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
        ]
        
        response = self.client.models.generate_content(
            model=self.model_name,
            contents=[types.Content(role="user", parts=request_parts)],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=VisionObservations,
                temperature=0.0
            ),
        )
        return json.loads(response.text)

# ==========================================
# 🤝 שלב 3.5: מגשר ההצהרות (The Smart Reconciler)
# ==========================================
class DeclarationReconciler:
    @staticmethod
    def reconcile(vision_facts: dict, crm_json: dict):
        crm_text = json.dumps(crm_json, ensure_ascii=False).lower()
        effective_facts = copy.deepcopy(vision_facts)
        approved_declarations = []

        # 1. עסק / מסחר
        commercial = effective_facts.get('commercial_or_industrial_equipment_detected', {})
        if commercial.get('detected') is True:
            if "עסק" in crm_text or "מסחר" in crm_text or "קליניקה" in crm_text:
                effective_facts['commercial_or_industrial_equipment_detected']['detected'] = False
                effective_facts['commercial_or_industrial_equipment_detected']['confidence'] = 0.0
                effective_facts['commercial_or_industrial_equipment_detected']['evidence'] = "APPROVED_BY_CRM_DO_NOT_FLAG"
                approved_declarations.append("✅ **עסק פעיל:** זוהה ציוד מסחרי, אך הלקוח היה כנה והצהיר על כך מראש (אין קנס אמינות).")

        # 2. פרגולה
        pergola = effective_facts.get('pergola_detected', {})
        if pergola.get('detected') is True:
            if "פרגולה" in crm_text or "סככה" in crm_text:
                effective_facts['pergola_detected']['detected'] = False
                effective_facts['pergola_detected']['confidence'] = 0.0
                effective_facts['pergola_detected']['evidence'] = "APPROVED_BY_CRM_DO_NOT_FLAG"
                approved_declarations.append("✅ **פרגולה:** המערכת זיהתה פרגולה שהוצהרה במדויק ב-CRM.")

        # 3. יוקרה / רמת גימור גבוהה
        luxury = effective_facts.get('high_end_materials_or_smart_home_detected', {})
        if luxury.get('detected') is True:
            if "יוקרת" in crm_text or "יוקרה" in crm_text:
                effective_facts['high_end_materials_or_smart_home_detected']['detected'] = False
                effective_facts['high_end_materials_or_smart_home_detected']['confidence'] = 0.0
                effective_facts['high_end_materials_or_smart_home_detected']['evidence'] = "APPROVED_BY_CRM_DO_NOT_FLAG"
                approved_declarations.append("✅ **רמת גימור:** הדירה זוהתה כדירת יוקרה, תואם לתיאור בפוליסה.")

        return effective_facts, approved_declarations

# ==========================================
# 🧠 שלב 4: ה-Agent של קלוד (Logic by Claude 4.6 Sonnet)
# ==========================================
class ClaudeUnderwriterAgent:
    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model_name = "claude-sonnet-4-6"  # מעודכן למודל הזמין ב-API

    def evaluate_risk(self, vision_facts: dict, crm_data: dict, gps_data: dict = None) -> dict:
        gps_context = f"GPS Data provided from device: {gps_data}" if gps_data else "No GPS data provided."
        
        prompt = f"""
        You are an elite Lead Insurance Underwriter. You must evaluate risk based on AI visual facts compared to CRM data.
        
        === 🚨 SUPREME DIRECTIVE: CRM APPROVALS (CRITICAL!) 🚨 ===
        Some findings have been pre-approved by the human underwriting committee.
        If the 'evidence' field for any item is exactly "APPROVED_BY_CRM_DO_NOT_FLAG":
        1. You MUST set "triggered": false for that flag.
        2. You MUST apply ZERO penalty to the score for that item.
        3. You MUST NOT reference the visual_evidence_log or CRM text to overrule this.
        
        CRITICALLY: You must account for the AI's confidence levels on all OTHER items.
        If a visual finding's confidence is < 0.70 or 'detected' is null, do NOT treat it as absolute truth. Treat it as a "low confidence warning" and reduce its score impact by 70%.
        
        === DATA FROM AI INSPECTOR (GEMINI) ===
        {json.dumps(vision_facts, indent=2)}
        
        === DATA FROM CRM (CLIENT DECLARATION) ===
        {json.dumps(crm_data, indent=2)}
        
        === GPS LOCATION DATA ===
        {gps_context}
        
        === THE 12 UNDERWRITING RULES ===
        Evaluate flags. A flag object should look like: {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}}
        1. unoccupied: Based on `is_empty_of_furniture`. Compare with CRM `underwriting_questions.is_unoccupied_frequently`.
        2. moisture_signs: Based on `visible_moisture_or_mold`.
        3. severe_neglect: Based on `visible_severe_damage_or_wear`.
        4. age_mismatch: Compare `estimated_age_years` with CRM `property_details.year_built`.
        5. overcrowded: Is `estimated_occupants_based_on_beds_and_items` > 10?
        6. large_pergola: Based on `pergola_detected`.
        7. expensive_storage: Based on `high_value_items_in_storage_detected`.
        8. split_apartment: Based on `multiple_entrance_doors_detected`.
        9. business_activity: Based on `commercial_or_industrial_equipment_detected`. Check if CRM `property_used_for_business` is true.
        10. luxury: Based on `high_end_materials_or_smart_home_detected`.
        11. pool_or_jacuzzi: Based on `pool_or_jacuzzi_detected`.
        12. area_exceeds_20_percent: Is `estimated_area_sqm` > (CRM `area_sqm` * 1.20)?

        === SCORING LOGIC ===
        Start with 100 points.
        For each triggered flag (ONLY IF "triggered" is true):
        - If high confidence (>=0.70): Apply full penalty.
        - If low confidence (<0.70): Apply only 30% of the penalty.

        Output strict JSON matching this schema exactly. Do not use unescaped quotes inside strings.
        {{
            "flags": {{
                "unoccupied": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}},
                "moisture_signs": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}},
                "severe_neglect": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}},
                "age_mismatch": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}},
                "overcrowded": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}},
                "large_pergola": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}},
                "expensive_storage": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}},
                "split_apartment": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}},
                "business_activity": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}},
                "luxury": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}},
                "pool_or_jacuzzi": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}},
                "area_exceeds_20_percent": {{"triggered": bool, "is_high_confidence": bool, "evidence": "string"}}
            }},
            "score": int,
            "decision": "Approve / Manual Review / Reject",
            "reasoning_for_crm": "A summary in Hebrew."
        }}
        """

        message = self.client.messages.create(
            model=self.model_name,
            max_tokens=4000,
            temperature=0.0,
            system="You are a strict AI underwriting engine. Output ONLY raw valid JSON. No markdown wrappers.",
            messages=[{"role": "user", "content": prompt}]
        )
        
        response_text = message.content[0].text.strip()
        
        if response_text.startswith("```json"):
            response_text = response_text[7:-3].strip()
        elif response_text.startswith("```"):
            response_text = response_text[3:-3].strip()
            
        try:
            return json.loads(response_text)
        except json.JSONDecodeError as e:
            raise Exception(f"Claude החזיר JSON שבור: \n\n{e}\n\nהטקסט שקלוד החזיר:\n{response_text}")

# ==========================================
# 🌐 שלב 5: שרת ה-API (FastAPI Endpoint)
# ==========================================
@app.post("/analyze")
async def analyze_image(payload: dict = Body(...)):
    try:
        image_url = payload.get("image_url")
        expected_room = payload.get("expected_room", "נכס")
        gps_data = payload.get("gps") 
        
        if not image_url:
            raise HTTPException(status_code=400, detail="Missing image_url")

        print(f"📥 מוריד תמונה מ-Cloudinary: {image_url}")
        print(f"🔍 החדר המצופה: {expected_room}")
        
        # התוספת הקריטית עבור נטפרי: verify=False
        img_res = requests.get(image_url, verify=False)
        
        if img_res.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to download image from URL")
            
        image_bytes = img_res.content
        
        # 1. מפעיל את ג'מיני
        print("🤖 מפעיל Gemini...")
        gemini_agent = GeminiVisionAgent(api_key=GEMINI_KEY)
        vision_facts = gemini_agent.process_and_analyze(image_bytes=image_bytes, expected_room=expected_room)
        
        # 🛑 חסימות הסלקטור
        if not vision_facts.get("is_valid_property", True):
            reason = vision_facts.get("invalid_property_reason", "התמונה לא תואמת נהלי חיתום.")
            print(f"❌ נפסל בכניסה: זה לא נכס - {reason}")
            raise HTTPException(status_code=400, detail=f"invalid_property: {reason}")
            
        if not vision_facts.get("is_expected_room", True):
            reason = vision_facts.get("room_mismatch_reason", "התמונה לא תואמת לחדר המבוקש.")
            print(f"❌ נפסל בכניסה: חדר לא תואם - {reason}")
            raise HTTPException(status_code=400, detail=f"ROOM_MISMATCH: {reason}")
        
        # 2. גישור הצהרות מול CRM
        print("⚖️ מפעיל Declaration Reconciler...")
        reconciler = DeclarationReconciler()
        effective_facts, approved_declarations = reconciler.reconcile(vision_facts, SAMPLE_CRM_DATA)
        
        # 3. מפעיל את קלוד
        print("🧠 מפעיל Claude...")
        claude_agent = ClaudeUnderwriterAgent(api_key=CLAUDE_KEY)
        underwriting_result = claude_agent.evaluate_risk(effective_facts, SAMPLE_CRM_DATA, gps_data)
        
        # החזרת התוצאה הסופית
        return JSONResponse(content={
            "vision": vision_facts,
            "effective_facts": effective_facts,
            "approved_declarations": approved_declarations,
            "underwriting": underwriting_result
        })

    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"❌ שגיאה כללית בשרת: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


def _aggregate_vision_facts(vision_facts_list: list[dict]) -> dict:
    if not vision_facts_list:
        return {}

    aggregated = copy.deepcopy(vision_facts_list[0])

    aggregated["visual_evidence_log"] = "\n\n".join(
        [vf.get("visual_evidence_log", "") for vf in vision_facts_list if vf.get("visual_evidence_log")]
    )
    aggregated["identified_areas"] = sorted(
        list({area for vf in vision_facts_list for area in (vf.get("identified_areas") or [])})
    )

    finding_keys = [
        "is_empty_of_furniture",
        "visible_moisture_or_mold",
        "visible_severe_damage_or_wear",
        "pergola_detected",
        "high_value_items_in_storage_detected",
        "multiple_entrance_doors_detected",
        "commercial_or_industrial_equipment_detected",
        "high_end_materials_or_smart_home_detected",
        "pool_or_jacuzzi_detected",
    ]

    for key in finding_keys:
        best = None
        for vf in vision_facts_list:
            item = vf.get(key)
            if not isinstance(item, dict):
                continue
            if item.get("detected") is True:
                if best is None or float(item.get("confidence", 0.0)) > float(best.get("confidence", 0.0)):
                    best = item
        if best is not None:
            aggregated[key] = best

    occupants = [vf.get("estimated_occupants_based_on_beds_and_items") for vf in vision_facts_list]
    occupants = [x for x in occupants if isinstance(x, int)]
    aggregated["estimated_occupants_based_on_beds_and_items"] = max(occupants) if occupants else None

    age = [vf.get("estimated_age_years") for vf in vision_facts_list]
    age = [x for x in age if isinstance(x, int)]
    aggregated["estimated_age_years"] = age[0] if age else None

    area = [vf.get("estimated_area_sqm") for vf in vision_facts_list]
    area = [x for x in area if isinstance(x, int)]
    aggregated["estimated_area_sqm"] = max(area) if area else None

    aggregated["is_valid_property"] = all(bool(vf.get("is_valid_property", True)) for vf in vision_facts_list)
    aggregated["invalid_property_reason"] = None
    aggregated["is_expected_room"] = True
    aggregated["room_mismatch_reason"] = None

    return aggregated


@app.post("/analyze_batch")
async def analyze_batch(payload: dict = Body(...)):
    try:
        images = payload.get("images")
        session_id = payload.get("session_id")
        gps_data = payload.get("gps")
        crm_data = payload.get("crm_data")  # קבלת נתוני CRM מה-request
        
        # שימוש בנתוני CRM שמתקבלים, או בנתוני דוגמה אם לא התקבלו
        effective_crm_data = crm_data if crm_data else SAMPLE_CRM_DATA
        
        print(f"\n🔔 [Batch:{session_id}] Received batch request")
        print(f"   Images count: {len(images) if images else 0}")
        print(f"   GPS: {gps_data is not None}")
        print(f"   CRM Data: {'Custom (from React)' if crm_data else 'Default (SAMPLE_CRM_DATA)'}")

        if not images or not isinstance(images, list):
            print(f"❌ [Batch:{session_id}] Invalid images data: {type(images)}")
            raise HTTPException(status_code=400, detail="Missing images list")

        gemini_agent = GeminiVisionAgent(api_key=GEMINI_KEY)

        per_image_vision = []
        input_warnings = []
        for idx, item in enumerate(images):
            image_url = (item or {}).get("image_url")
            expected_room = (item or {}).get("expected_room", "נכס")
            if not image_url:
                raise HTTPException(status_code=400, detail=f"Missing image_url at index {idx}")

            print(f"📥 [Batch:{session_id}] מוריד תמונה {idx + 1}/{len(images)}: {image_url}")
            try:
                img_res = requests.get(image_url, verify=False, timeout=30)
                print(f"✅ Download response status: {img_res.status_code}, size: {len(img_res.content)} bytes")
            except Exception as e:
                print(f"❌ Download failed: {e}")
                raise HTTPException(status_code=400, detail=f"Failed to download image from URL at index {idx}: {str(e)}")
            
            if img_res.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Failed to download image from URL at index {idx}: HTTP {img_res.status_code}")

            # ניסיונות חוזרים (retry) עבור שגיאות 503 של Gemini
            max_retries = 3
            retry_delay = 3  # שניות
            vision_facts = None
            last_error = None
            
            for attempt in range(max_retries):
                try:
                    print(f"🤖 [Batch:{session_id}] Analyzing image {idx + 1} with Gemini... (attempt {attempt + 1}/{max_retries})")
                    vision_facts = await asyncio.wait_for(
                        asyncio.to_thread(
                            gemini_agent.process_and_analyze,
                            image_bytes=img_res.content,
                            expected_room=expected_room,
                        ),
                        timeout=240,  # הגדלתי ל-4 דקות לבטיחות מוחלטת עם הרבה תמונות
                    )
                    print(f"✅ [Batch:{session_id}] Gemini analysis complete for image {idx + 1}")
                    print(f"   is_valid_property: {vision_facts.get('is_valid_property', True)}")
                    print(f"   is_expected_room: {vision_facts.get('is_expected_room', True)}")
                    break  # הצלחה - יוצאים מהלולאה
                    
                except asyncio.TimeoutError:
                    print(f"⏱️ [Batch:{session_id}] Gemini timeout for image {idx + 1}")
                    raise HTTPException(
                        status_code=503,
                        detail=f"Gemini timeout while analyzing image[{idx}]. Please try again or reduce number of images.",
                    )
                except Exception as e:
                    last_error = e
                    msg = str(e)
                    
                    # בדיקה אם זו שגיאת 503 - אז ננסה שוב
                    if '503' in msg or 'UNAVAILABLE' in msg or 'high demand' in msg:
                        if attempt < max_retries - 1:
                            print(f"⚠️ [Batch:{session_id}] Gemini 503 error (attempt {attempt + 1}/{max_retries}), retrying in {retry_delay}s...")
                            await asyncio.sleep(retry_delay)
                            continue  # מנסה שוב
                        else:
                            print(f"❌ [Batch:{session_id}] Gemini 503 error after {max_retries} attempts")
                            raise HTTPException(
                                status_code=503,
                                detail=f"Gemini API is currently unavailable due to high demand. Please try again in a few minutes.",
                            )
                    
                    # שגיאות אחרות - לא מנסים שוב
                    if 'NetFree' in msg or '418' in msg:
                        raise HTTPException(
                            status_code=503,
                            detail="Gemini API is blocked by the network filter (NetFree). Allow access to generativelanguage.googleapis.com or use a different network.",
                        )
                    raise

            if not vision_facts.get("is_valid_property", True):
                reason = vision_facts.get("invalid_property_reason", "התמונה לא תואמת נהלי חיתום.")
                print(f"❌ [Batch:{session_id}] Image {idx + 1} REJECTED by selector: {reason}")
                raise HTTPException(status_code=400, detail=f"invalid_property[{idx}]: {reason}")

            if not vision_facts.get("is_expected_room", True):
                reason = vision_facts.get("room_mismatch_reason", "התמונה לא תואמת לחדר המבוקש.")
                input_warnings.append({
                    "type": "ROOM_MISMATCH",
                    "index": idx,
                    "expected_room": expected_room,
                    "reason": reason,
                    "image_url": image_url,
                })

            per_image_vision.append({
                "index": idx,
                "image_url": image_url,
                "expected_room": expected_room,
                "vision": vision_facts,
            })

        aggregated_vision = _aggregate_vision_facts([x["vision"] for x in per_image_vision])

        reconciler = DeclarationReconciler()
        effective_facts, approved_declarations = reconciler.reconcile(aggregated_vision, effective_crm_data)

        claude_agent = ClaudeUnderwriterAgent(api_key=CLAUDE_KEY)
        underwriting_result = claude_agent.evaluate_risk(effective_facts, effective_crm_data, gps_data)

        return JSONResponse(content={
            "session_id": session_id,
            "input_warnings": input_warnings,
            "per_image": per_image_vision,
            "vision": aggregated_vision,
            "effective_facts": effective_facts,
            "approved_declarations": approved_declarations,
            "underwriting": underwriting_result
        })

    except HTTPException as he:
        print(f"⚠️ [Batch:{session_id}] HTTPException: {he.status_code} - {he.detail}")
        raise he
    except Exception as e:
        import traceback
        print(f"❌ [Batch:{session_id}] שגיאה כללית בשרת:")
        print(f"   Error: {str(e)}")
        print(f"   Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run(app, host="0.0.0.0", port=port)