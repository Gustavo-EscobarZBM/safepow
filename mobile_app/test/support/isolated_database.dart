import 'package:inventory_loss_app/core/storage/app_database.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Cada arquivo de teste roda num isolate próprio; com um banco EM MEMÓRIA por isolate, os arquivos não
/// compartilham mais o mesmo arquivo SQLite (causa da intermitência da suíte em paralelo).
Future<void> useIsolatedTestDatabase() async {
  sqfliteFfiInit();
  databaseFactory = databaseFactoryFfi;
  await AppDatabase.instance.useDatabaseAtForTesting(inMemoryDatabasePath);
}
