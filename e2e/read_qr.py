"""Prints the text of the QR code in a screenshot (needs opencv-python-headless)."""
import sys
import cv2

img = cv2.imread(sys.argv[1])
text, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
if not text:
    big = cv2.resize(img, None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)
    text, _, _ = cv2.QRCodeDetector().detectAndDecode(big)
print(text)
