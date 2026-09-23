import 'package:flutter/material.dart';
import '../../core/util/barcode_bars.dart';

const _designWidth = 300;
const _gold = Color(0xFFB4922D);

/// Código de barras "sendo lido": uma linha dourada varre as barras e revela,
/// atrás dela, a camada escura (lida). Com "remover animações" ativado no
/// sistema, fica parado com a leitura já em ~62%.
class BarcodeScan extends StatefulWidget {
  final double height;
  const BarcodeScan({super.key, this.height = 64});

  @override
  State<BarcodeScan> createState() => _BarcodeScanState();
}

class _BarcodeScanState extends State<BarcodeScan> with SingleTickerProviderStateMixin {
  late final AnimationController _controller =
      AnimationController(vsync: this, duration: const Duration(seconds: 7));
  final _bars = buildBarcodeBars(7, _designWidth);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _controller.stop();
      _controller.value = 0.62;
    } else if (!_controller.isAnimating) {
      _controller.repeat(reverse: true, period: const Duration(seconds: 7));
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ink = Theme.of(context).colorScheme.onSurface;
    return Semantics(
      label: 'Código de barras sendo lido',
      image: true,
      child: ExcludeSemantics(
        child: SizedBox(
          height: widget.height,
          width: double.infinity,
          child: AnimatedBuilder(
            animation: _controller,
            builder: (context, _) => CustomPaint(
              painter: _BarcodePainter(bars: _bars, progress: _controller.value, ink: ink),
            ),
          ),
        ),
      ),
    );
  }
}

class _BarcodePainter extends CustomPainter {
  final List<BarcodeBar> bars;
  final double progress;
  final Color ink;

  _BarcodePainter({required this.bars, required this.progress, required this.ink});

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / _designWidth;
    final muted = Paint()..color = ink.withAlpha(64);
    final read = Paint()..color = ink;
    final readEdge = size.width * progress;

    for (final bar in bars) {
      final rect = Rect.fromLTWH(bar.x * scale, 0, bar.width * scale, size.height);
      canvas.drawRect(rect, muted);
      final visible = rect.intersect(Rect.fromLTRB(0, 0, readEdge, size.height));
      if (!visible.isEmpty) canvas.drawRect(visible, read);
    }

    canvas.drawRect(Rect.fromLTWH(readEdge.clamp(0, size.width - 2), 0, 2, size.height), Paint()..color = _gold);
  }

  @override
  bool shouldRepaint(_BarcodePainter old) => old.progress != progress || old.ink != ink;
}
